import express from 'express';
import cors from 'cors';
import path from 'path';
import { CONFIG } from './config';
import { initDatabase } from './db/database';
import { authenticateJWT } from './middleware/auth';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import camerasRouter from './routes/cameras';
import recordingsRouter from './routes/recordings';
import systemRouter from './routes/system';
import facesRouter from './routes/faces';
import detectionsRouter from './routes/detections';
import { FFmpegManager } from './services/ffmpeg-manager';
import { StorageManager } from './services/storage-manager';
import fs from 'fs';

const app = express();
const ffmpegManager = FFmpegManager.getInstance();
const storageManager = StorageManager.getInstance();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/cameras', camerasRouter);
app.use('/api/recordings', recordingsRouter);
app.use('/api/system', systemRouter);
app.use('/api/faces', facesRouter);
app.use('/api/detections', detectionsRouter);

// Protected static serving of live HLS video streams (playlists and chunks)
app.use('/live', authenticateJWT, express.static(CONFIG.LIVE_PATH));

// Serve face registration reference uploads
const dbDir = path.dirname(CONFIG.DB_PATH);
const uploadsDir = path.join(dbDir, 'uploads', 'faces');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads/faces', authenticateJWT, express.static(uploadsDir));

// Serve AI event snapshots
const recordingsPath = process.env.RECORDINGS_PATH || path.resolve(process.cwd(), 'recordings');
const snapshotsDir = path.join(recordingsPath, 'snapshots');
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir, { recursive: true });
}
app.use('/snapshots', authenticateJWT, express.static(snapshotsDir));

// Main startup function
async function bootstrap() {
  try {
    console.log('Initializing SQLite Database...');
    await initDatabase(CONFIG.DB_PATH);
    console.log(`Database initialized successfully at ${CONFIG.DB_PATH}`);

    // Start Express server
    const server = app.listen(CONFIG.PORT, '0.0.0.0', () => {
      console.log(`=========================================`);
      console.log(` CCTV NVR API Backend Running on port ${CONFIG.PORT} `);
      console.log(` Live Stream Directory: ${CONFIG.LIVE_PATH} `);
      console.log(` Mode: ${process.env.NODE_ENV || 'development'} `);
      console.log(`=========================================`);
    });

    // Graceful Shutdown Handler
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}. Starting graceful shutdown...`);
      server.close(() => {
        console.log('HTTP server closed.');
      });
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('Fatal backend bootstrap error:', err);
    process.exit(1);
  }
}

bootstrap();
