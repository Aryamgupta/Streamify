import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getDb } from '../db/database';
import { CONFIG } from '../config';

interface CameraProcessState {
  recorder: ChildProcess | null;
  live: ChildProcess | null;
  currentRecordingFile: string | null;
  restartTimer: NodeJS.Timeout | null;
  retries: number;
}

export class FFmpegManager {
  private static instance: FFmpegManager;
  private processes = new Map<number, CameraProcessState>();
  private ensureDirInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Periodically pre-create directories for today/tomorrow
    this.ensureDirInterval = setInterval(() => {
      this.ensureAllDirectories();
    }, 60 * 60 * 1000); // Every hour
  }

  public static getInstance(): FFmpegManager {
    if (!FFmpegManager.instance) {
      FFmpegManager.instance = new FFmpegManager();
    }
    return FFmpegManager.instance;
  }

  /**
   * Run ffprobe to verify RTSP stream connectivity
   */
  public async testConnection(rtspUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      const isRtsp = rtspUrl.startsWith('rtsp://') || rtspUrl.startsWith('rtmp://');
      const args = isRtsp
        ? ['-rtsp_transport', 'tcp', '-v', 'quiet', '-timeout', '3000000', '-show_streams', rtspUrl]
        : ['-v', 'quiet', '-show_streams', rtspUrl];

      console.log(`Testing connection to: ${rtspUrl} with arguments: ${args.join(' ')}`);
      const probe = spawn('ffprobe', args);

      const timeout = setTimeout(() => {
        probe.kill('SIGKILL');
        console.log(`Connection test timed out for: ${rtspUrl}`);
        resolve(false);
      }, 5000);

      probe.on('exit', (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });

      probe.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`ffprobe error for ${rtspUrl}:`, err);
        resolve(false);
      });
    });
  }

  /**
   * Helper to ensure directories exist for today and tomorrow
   */
  private ensureDirectories(cameraId: number, storagePath: string) {
    const today = this.formatDate(new Date());
    const tomorrow = this.formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const camRecordingsToday = path.join(storagePath, `cam-${cameraId}`, today);
    const camRecordingsTomorrow = path.join(storagePath, `cam-${cameraId}`, tomorrow);
    const camLive = path.join(CONFIG.LIVE_PATH, `cam-${cameraId}`);

    fs.mkdirSync(camRecordingsToday, { recursive: true });
    fs.mkdirSync(camRecordingsTomorrow, { recursive: true });
    fs.mkdirSync(camLive, { recursive: true });
  }

  private async ensureAllDirectories() {
    try {
      const db = getDb();
      const cameras = await db.all<{ id: number }[]>('SELECT id FROM cameras WHERE enabled = 1');
      const storagePath = await this.getStoragePath();

      for (const camera of cameras) {
        this.ensureDirectories(camera.id, storagePath);
      }
    } catch (err) {
      console.error('Error pre-creating directories:', err);
    }
  }

  private formatDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private async getStoragePath(): Promise<string> {
    const db = getDb();
    const setting = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'storage_path'");
    return setting ? setting.value : path.resolve(__dirname, '../../../recordings');
  }

  private async getSegmentDuration(): Promise<number> {
    const db = getDb();
    const setting = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'segment_duration'");
    return setting ? parseInt(setting.value, 10) : 300;
  }

  /**
   * Start recording and live HLS stream for a camera
   */
  public async startCamera(cameraId: number) {
    const db = getDb();
    const camera = await db.get<{ id: number; name: string; rtsp_url: string; enabled: number }>(
      'SELECT * FROM cameras WHERE id = ?',
      cameraId
    );

    if (!camera || !camera.enabled) {
      return;
    }

    // Stop if already running
    await this.stopCamera(cameraId);

    const storagePath = await this.getStoragePath();
    const segmentDuration = await this.getSegmentDuration();

    // Ensure target directories exist
    this.ensureDirectories(cameraId, storagePath);

    console.log(`Starting camera [${camera.id}] ${camera.name}...`);

    let state = this.processes.get(cameraId);
    if (!state) {
      state = {
        recorder: null,
        live: null,
        currentRecordingFile: null,
        restartTimer: null,
        retries: 0
      };
      this.processes.set(cameraId, state);
    }

    const isRtsp = camera.rtsp_url.startsWith('rtsp://') || camera.rtsp_url.startsWith('rtmp://');

    // 1. Spawning Recording Process
    // Format path using strftime: cam-ID/YYYY-MM-DD/HH-MM.mp4
    const outPattern = path.join(storagePath, `cam-${cameraId}`, '%Y-%m-%d', '%H-%M.mp4');
    
    const recordArgs = isRtsp
      ? [
          '-rtsp_transport', 'tcp',
          '-i', camera.rtsp_url,
          '-c', 'copy',
          '-f', 'segment',
          '-segment_time', String(segmentDuration),
          '-segment_at_time', '1',
          '-reset_timestamps', '1',
          '-strftime', '1',
          '-segment_format_options', 'movflags=+faststart',
          outPattern
        ]
      : [
          '-re',
          '-stream_loop', '-1',
          '-i', camera.rtsp_url,
          '-c', 'copy',
          '-f', 'segment',
          '-segment_time', String(segmentDuration),
          '-reset_timestamps', '1',
          '-strftime', '1',
          '-segment_format_options', 'movflags=+faststart',
          outPattern
        ];

    console.log(`Spawning recorder for cam ${cameraId}: ffmpeg ${recordArgs.join(' ')}`);
    const recorder = spawn('ffmpeg', recordArgs);
    state.recorder = recorder;

    // Monitor recorder logs to index complete segments
    let stderrBuffer = '';
    recorder.stderr?.on('data', (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || ''; // Keep last partial line

      for (const line of lines) {
        // Look for completed segment message: [segment @ 0x...] Opening '...' for writing
        const match = line.match(/Opening '(.+)' for writing/);
        if (match) {
          const newFile = match[1];
          const oldFile = state!.currentRecordingFile;
          
          state!.currentRecordingFile = newFile;
          
          if (oldFile) {
            this.indexCompletedSegment(cameraId, oldFile);
          }
        }
      }
    });

    recorder.on('exit', (code, signal) => {
      console.log(`Recorder process for camera ${cameraId} exited with code ${code}, signal ${signal}`);
      state!.recorder = null;
      this.handleProcessCrash(cameraId);
    });

    // 2. Spawning Live HLS Process
    const liveDir = path.join(CONFIG.LIVE_PATH, `cam-${cameraId}`);
    const livePlaylist = path.join(liveDir, 'index.m3u8');
    const liveSegmentFilename = path.join(liveDir, 'seq_%d.ts');

    const liveArgs = isRtsp
      ? [
          '-rtsp_transport', 'tcp',
          '-i', camera.rtsp_url,
          '-c', 'copy',
          '-f', 'hls',
          '-hls_time', '2',
          '-hls_list_size', '5',
          '-hls_flags', 'delete_segments+append_list',
          '-hls_segment_filename', liveSegmentFilename,
          livePlaylist
        ]
      : [
          '-re',
          '-stream_loop', '-1',
          '-i', camera.rtsp_url,
          '-c', 'copy',
          '-f', 'hls',
          '-hls_time', '2',
          '-hls_list_size', '5',
          '-hls_flags', 'delete_segments+append_list',
          '-hls_segment_filename', liveSegmentFilename,
          livePlaylist
        ];

    console.log(`Spawning live HLS stream for cam ${cameraId}: ffmpeg ${liveArgs.join(' ')}`);
    const live = spawn('ffmpeg', liveArgs);
    state.live = live;

    live.on('exit', (code, signal) => {
      console.log(`Live HLS process for camera ${cameraId} exited with code ${code}, signal ${signal}`);
      state!.live = null;
      this.handleProcessCrash(cameraId);
    });
  }

  /**
   * Index completed recording segment into database
   */
  private async indexCompletedSegment(cameraId: number, filePath: string) {
    try {
      if (!fs.existsSync(filePath)) {
        return;
      }

      const stat = fs.statSync(filePath);
      if (stat.size === 0) {
        return;
      }

      // Parse date and start time from path: cam-1/YYYY-MM-DD/HH-MM.mp4
      const filename = path.basename(filePath);
      const dirName = path.basename(path.dirname(filePath));
      const timeMatch = filename.match(/^(\d{2})-(\d{2})/);

      if (timeMatch && /^\d{4}-\d{2}-\d{2}$/.test(dirName)) {
        const hh = timeMatch[1];
        const mm = timeMatch[2];
        
        // Start time (local)
        const startTime = new Date(`${dirName}T${hh}:${mm}:00`);
        const duration = await this.getSegmentDuration();
        const endTime = new Date(startTime.getTime() + duration * 1000);

        const db = getDb();
        await db.run(
          'INSERT OR IGNORE INTO recordings (camera_id, file_path, start_time, end_time, size) VALUES (?, ?, ?, ?, ?)',
          cameraId,
          filePath,
          startTime.toISOString(),
          endTime.toISOString(),
          stat.size
        );
        console.log(`Indexed completed segment for camera ${cameraId}: ${path.basename(filePath)} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
      }
    } catch (err) {
      console.error(`Failed to index segment ${filePath}:`, err);
    }
  }

  /**
   * Handle FFmpeg process crash with auto-recovery
   */
  private handleProcessCrash(cameraId: number) {
    const state = this.processes.get(cameraId);
    if (!state) return;

    // If both processes are stopped, we don't recover (it was a stop command)
    if (state.recorder === null && state.live === null) {
      return;
    }

    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
    }

    // Cooldown check
    state.retries++;
    const delay = Math.min(10000 * Math.pow(1.5, state.retries - 1), 60000); // Exp backoff caps at 60s
    console.log(`Camera [${cameraId}] crashed. Auto-recovery active. Restarting in ${(delay / 1000).toFixed(1)}s (retry #${state.retries})`);

    state.restartTimer = setTimeout(async () => {
      try {
        await this.startCamera(cameraId);
      } catch (err) {
        console.error(`Failed to auto-recover camera ${cameraId}:`, err);
      }
    }, delay);
  }

  /**
   * Stop recording and HLS for a camera
   */
  public async stopCamera(cameraId: number) {
    const state = this.processes.get(cameraId);
    if (!state) return;

    console.log(`Stopping camera [${cameraId}] processes...`);

    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }

    // Clear state triggers to prevent auto-recovery loop
    const recorder = state.recorder;
    const live = state.live;
    state.recorder = null;
    state.live = null;

    if (recorder && !recorder.killed) {
      recorder.kill('SIGTERM');
      // Wait for it to exit, or force kill after 3s
      setTimeout(() => {
        try { recorder.kill('SIGKILL'); } catch {}
      }, 3000);
    }

    if (live && !live.killed) {
      live.kill('SIGTERM');
      setTimeout(() => {
        try { live.kill('SIGKILL'); } catch {}
      }, 3000);
    }

    // Index the active file if it exists since we're stopping it
    if (state.currentRecordingFile) {
      const file = state.currentRecordingFile;
      state.currentRecordingFile = null;
      // Small timeout to allow FFmpeg to finish flushing the file
      setTimeout(() => {
        this.indexCompletedSegment(cameraId, file);
      }, 1000);
    }

    state.retries = 0;
  }

  /**
   * Start all enabled cameras at boot
   */
  public async startAllEnabledCameras() {
    const db = getDb();
    const cameras = await db.all<{ id: number }[]>('SELECT id FROM cameras WHERE enabled = 1');
    console.log(`Starting all enabled cameras (${cameras.length})...`);
    for (const camera of cameras) {
      await this.startCamera(camera.id);
    }
  }

  /**
   * Stop all active cameras
   */
  public async stopAll() {
    if (this.ensureDirInterval) {
      clearInterval(this.ensureDirInterval);
      this.ensureDirInterval = null;
    }

    const ids = Array.from(this.processes.keys());
    for (const id of ids) {
      await this.stopCamera(id);
    }
  }

  /**
   * Status indicators for live dashboard
   */
  public getCameraStatus(cameraId: number): { online: boolean; recording: boolean } {
    const state = this.processes.get(cameraId);
    if (!state) {
      return { online: false, recording: false };
    }
    return {
      online: state.live !== null,
      recording: state.recorder !== null
    };
  }

  /**
   * Recursive directory synchronization to index missing recordings on disk
   */
  public async syncRecordingsFromDisk() {
    console.log('Synchronizing recordings database with disk...');
    try {
      const storagePath = await this.getStoragePath();
      if (!fs.existsSync(storagePath)) return;

      const db = getDb();
      const cameras = await db.all<{ id: number }[]>('SELECT id FROM cameras');

      for (const camera of cameras) {
        const camDir = path.join(storagePath, `cam-${camera.id}`);
        if (!fs.existsSync(camDir)) continue;

        const dates = fs.readdirSync(camDir);
        for (const dateFolder of dates) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFolder)) continue;

          const datePath = path.join(camDir, dateFolder);
          const files = fs.readdirSync(datePath);

          for (const file of files) {
            if (!file.endsWith('.mp4')) continue;

            const filePath = path.join(datePath, file);
            
            // Check if already indexed
            const exists = await db.get('SELECT id FROM recordings WHERE file_path = ?', filePath);
            if (exists) continue;

            // Check if file is currently being written
            // If it was modified less than 10 minutes ago, skip it to avoid indexing active file
            const stat = fs.statSync(filePath);
            const mtimeAge = Date.now() - stat.mtimeMs;
            if (mtimeAge < 10 * 60 * 1000) {
              console.log(`Skipping active or recent file during sync: ${file}`);
              continue;
            }

            if (stat.size === 0) continue;

            // Index it!
            const timeMatch = file.match(/^(\d{2})-(\d{2})/);
            if (timeMatch) {
              const hh = timeMatch[1];
              const mm = timeMatch[2];
              const startTime = new Date(`${dateFolder}T${hh}:${mm}:00`);
              const duration = await this.getSegmentDuration();
              const endTime = new Date(startTime.getTime() + duration * 1000);

              await db.run(
                'INSERT OR IGNORE INTO recordings (camera_id, file_path, start_time, end_time, size) VALUES (?, ?, ?, ?, ?)',
                camera.id,
                filePath,
                startTime.toISOString(),
                endTime.toISOString(),
                stat.size
              );
              console.log(`Sync indexed file: ${camera.id}/${dateFolder}/${file}`);
            }
          }
        }
      }
      console.log('Recordings sync complete.');
    } catch (err) {
      console.error('Error synchronizing recordings from disk:', err);
    }
  }
}
