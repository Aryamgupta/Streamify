import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Auto-detect RAM disk availability to reduce SD card writes
const ramDiskPath = '/dev/shm/cctv-live';
let defaultLivePath = path.resolve(__dirname, '../../../live');

if (process.platform === 'linux' && fs.existsSync('/dev/shm')) {
  try {
    fs.mkdirSync(ramDiskPath, { recursive: true });
    defaultLivePath = ramDiskPath;
    console.log(`Detected Linux RAM disk, using ${ramDiskPath} for live HLS streams.`);
  } catch (err) {
    console.warn(`Failed to write to RAM disk, falling back to local storage:`, err);
  }
}

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  JWT_SECRET: process.env.JWT_SECRET || 'cctv-nvr-super-secret-key-change-this-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  DB_PATH: process.env.DB_PATH || path.resolve(__dirname, '../../../data/cctv.db'),
  LIVE_PATH: process.env.LIVE_PATH || defaultLivePath,
  MOCK_MODE: process.env.MOCK_MODE === 'true' || true // Enable mock mode by default for dev
};
