import { initDatabase } from './db/database';
import { CONFIG } from './config';
import { FFmpegManager } from './services/ffmpeg-manager';
import { StorageManager } from './services/storage-manager';
import { getDb } from './db/database';

const ffmpegManager = FFmpegManager.getInstance();
const storageManager = StorageManager.getInstance();

let pollInterval: NodeJS.Timeout | null = null;
let lastCameraStates = new Map<number, { enabled: number; rtsp_url: string }>();

// Compare database cameras with active processes and synchronize them
async function syncCamerasWithDatabase() {
  try {
    const db = getDb();
    const cameras = await db.all<{ id: number; enabled: number; rtsp_url: string }[]>(
      'SELECT id, enabled, rtsp_url FROM cameras'
    );

    const activeIds = new Set<number>();

    for (const camera of cameras) {
      activeIds.add(camera.id);
      const lastState = lastCameraStates.get(camera.id);

      if (camera.enabled === 1) {
        if (!lastState) {
          // New enabled camera
          console.log(`Daemon detected new camera: [${camera.id}]`);
          await ffmpegManager.startCamera(camera.id);
        } else if (lastState.enabled === 0 || lastState.rtsp_url !== camera.rtsp_url) {
          // Camera was re-enabled or URL changed
          console.log(`Daemon detected camera update: [${camera.id}]`);
          await ffmpegManager.startCamera(camera.id);
        }
      } else {
        // Camera is disabled
        if (lastState && lastState.enabled === 1) {
          console.log(`Daemon detected camera disabled: [${camera.id}]`);
          await ffmpegManager.stopCamera(camera.id);
        }
      }

      // Update state map
      lastCameraStates.set(camera.id, {
        enabled: camera.enabled,
        rtsp_url: camera.rtsp_url
      });
    }

    // Handle deleted cameras
    for (const id of lastCameraStates.keys()) {
      if (!activeIds.has(id)) {
        console.log(`Daemon detected camera deleted: [${id}]`);
        await ffmpegManager.stopCamera(id);
        lastCameraStates.delete(id);
      }
    }

  } catch (err) {
    console.error('Error in daemon sync loop:', err);
  }
}

async function startDaemon() {
  try {
    console.log('Starting CCTV Recorder Daemon...');
    console.log('Initializing SQLite database link...');
    await initDatabase(CONFIG.DB_PATH);
    console.log('Database connected.');

    // 1. Sync any recording files on disk with the DB indexer
    await ffmpegManager.syncRecordingsFromDisk();

    // 2. Perform initial camera process synchronization
    await syncCamerasWithDatabase();

    // 3. Start polling loop (every 5 seconds) to watch for changes
    pollInterval = setInterval(syncCamerasWithDatabase, 5000);

    // 4. Start retention cleanup checks
    await storageManager.runCleanup();

    console.log('=========================================');
    console.log(' CCTV NVR Recorder Daemon Running 24x7   ');
    console.log(' Press Ctrl+C to terminate               ');
    console.log('=========================================');

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}. Shutting down recorder daemon...`);
      if (pollInterval) {
        clearInterval(pollInterval);
      }

      storageManager.stop();
      console.log('Storage manager loop stopped.');

      console.log('Stopping active FFmpeg processes...');
      await ffmpegManager.stopAll();
      console.log('All FFmpeg processes terminated.');

      console.log('Recorder daemon shutdown complete.');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('Fatal recorder daemon startup error:', err);
    process.exit(1);
  }
}

startDaemon();
