import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getDb } from '../db/database';
import { CONFIG } from '../config';

interface CameraProcessState {
  process: ChildProcess | null;
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
        process: null,
        currentRecordingFile: null,
        restartTimer: null,
        retries: 0
      };
      this.processes.set(cameraId, state);
    }

    const isRtsp = camera.rtsp_url.startsWith('rtsp://') || camera.rtsp_url.startsWith('rtmp://');

    // Spawning a single FFmpeg process for both Recording and Live HLS
    // Format path using strftime: cam-ID/YYYY-MM-DD/HH-MM.mp4
    const outPattern = path.join(storagePath, `cam-${cameraId}`, '%Y-%m-%d', '%H-%M.mp4');
    
    const liveDir = path.join(CONFIG.LIVE_PATH, `cam-${cameraId}`);
    const livePlaylist = path.join(liveDir, 'index.m3u8');
    const liveSegmentFilename = path.join(liveDir, 'seq_%d.ts');

    const inputArgs = isRtsp
      ? ['-rtsp_transport', 'tcp', '-i', camera.rtsp_url]
      : ['-re', '-stream_loop', '-1', '-i', camera.rtsp_url];

    const args = [
      ...inputArgs,
      // Global/Input optimizations for low latency and stability
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      
      // Output 1: Segmented Recording
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'segment',
      '-segment_time', String(segmentDuration),
      '-reset_timestamps', '1',
      '-strftime', '1',
      '-segment_format_options', 'movflags=+faststart',
      outPattern,

      // Output 2: Live HLS Stream
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '2',
      '-hls_flags', 'delete_segments+omit_endlist',
      '-hls_segment_filename', liveSegmentFilename,
      livePlaylist
    ];

    console.log(`Spawning combined FFmpeg process for cam ${cameraId}...`);
    const ffmpegProcess = spawn('ffmpeg', args);
    state.process = ffmpegProcess;

    // Monitor logs to index complete segments and log errors
    let stderrBuffer = '';
    ffmpegProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      stderrBuffer += output;
      
      // Log errors for debugging
      if (output.toLowerCase().includes('error')) {
        console.error(`[FFMPEG CAM-${cameraId} ERROR]`, output.trim());
      }

      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || ''; // Keep last partial line

      for (const line of lines) {
        // Look for completed segment message: [segment @ 0x...] Opening '...' for writing
        const match = line.match(/Opening '(.+\.mp4)' for writing/);
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

    ffmpegProcess.on('exit', (code, signal) => {
      console.log(`FFmpeg process for camera ${cameraId} exited with code ${code}, signal ${signal}`);
      state!.process = null;
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

    // If process is stopped, we don't recover (it was a stop command)
    if (state.process === null) {
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
    const ffmpegProcess = state.process;
    state.process = null;

    if (ffmpegProcess && !ffmpegProcess.killed) {
      ffmpegProcess.kill('SIGTERM');
      // Wait for it to exit, or force kill after 3s
      setTimeout(() => {
        try { ffmpegProcess.kill('SIGKILL'); } catch {}
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
    // 1. Check local state (valid for cctv-recorder container)
    const state = this.processes.get(cameraId);
    if (state && state.process) {
      return { online: true, recording: true };
    }

    // 2. Cross-container check via shared filesystem (valid for cctv-backend container)
    try {
      const livePlaylist = path.join(CONFIG.LIVE_PATH, `cam-${cameraId}`, 'index.m3u8');
      if (fs.existsSync(livePlaylist)) {
        const stat = fs.statSync(livePlaylist);
        // If playlist was updated in the last 15 seconds, stream is active
        if (Date.now() - stat.mtimeMs < 15000) {
          return { online: true, recording: true };
        }
      }
    } catch (err) {
      // Ignore errors
    }

    return { online: false, recording: false };
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

            // Since this runs before FFmpeg processes are started at boot,
            // no file is actively being written, so all files are safe to index.
            const stat = fs.statSync(filePath);

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
