import { Router, Response } from 'express';
import os from 'os';
import { getDb } from '../db/database';
import { authenticateJWT, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { StorageManager } from '../services/storage-manager';
import { FFmpegManager } from '../services/ffmpeg-manager';
import { z } from 'zod';

const router = Router();
const storageManager = StorageManager.getInstance();
const ffmpegManager = FFmpegManager.getInstance();

// Secure all routes in this file
router.use(authenticateJWT);

// GET /api/system/status - Get system metrics (CPU, Memory, Camera states)
router.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    
    // CPU load average (1 min, 5 min, 15 min)
    const loadavg = os.loadavg();
    
    // Memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsagePercent = (usedMem / totalMem) * 100;

    // Get count of cameras
    const cameras = await db.all<{ id: number; enabled: number }[]>(
      'SELECT id, enabled FROM cameras'
    );
    const totalCameras = cameras.length;
    const enabledCameras = cameras.filter((c) => c.enabled === 1).length;

    // Determine active processes
    let activeRecorders = 0;
    let activeStreams = 0;
    for (const camera of cameras) {
      if (camera.enabled === 1) {
        const status = ffmpegManager.getCameraStatus(camera.id);
        if (status.recording) activeRecorders++;
        if (status.online) activeStreams++;
      }
    }

    res.json({
      uptime: process.uptime(), // seconds
      osUptime: os.uptime(), // seconds
      cpuLoad: loadavg[0], // 1-minute load average
      cpuCores: os.cpus().length,
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        percent: memoryUsagePercent
      },
      cameras: {
        total: totalCameras,
        enabled: enabledCameras,
        activeRecorders,
        activeStreams
      }
    });
  } catch (err: any) {
    console.error('System status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/system/storage - Get disk space statistics
router.get('/storage', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await storageManager.getStorageStats();
    res.json(stats);
  } catch (err: any) {
    console.error('System storage error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/system/settings - Get system configuration settings
router.get('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const settingsRows = await db.all<{ key: string; value: string }[]>('SELECT * FROM settings');
    
    const settings: Record<string, string> = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }

    res.json({
      segment_duration: parseInt(settings.segment_duration || '300', 10),
      retention_period: parseInt(settings.retention_period || '7', 10),
      storage_path: settings.storage_path || ''
    });
  } catch (err: any) {
    console.error('Fetch settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const settingsSchema = z.object({
  segment_duration: z.number().int().min(10, 'Segment must be at least 10 seconds').max(3600, 'Segment cannot exceed 1 hour'),
  retention_period: z.number().int().min(1, 'Retention must be at least 1 day').max(365, 'Retention cannot exceed 1 year'),
  storage_path: z.string().min(1, 'Storage path is required')
});

// PUT /api/system/settings - Update system settings (Admin only)
router.put('/settings', requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = settingsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { segment_duration, retention_period, storage_path } = parseResult.data;
    const db = getDb();

    // Fetch existing settings to see if they changed
    const currentSettings = await db.all<{ key: string; value: string }[]>('SELECT * FROM settings');
    const settingsMap = new Map(currentSettings.map((row) => [row.key, row.value]));

    const pathChanged = settingsMap.get('storage_path') !== storage_path;
    const durationChanged = settingsMap.get('segment_duration') !== String(segment_duration);

    // Save to database
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('segment_duration', ?)", String(segment_duration));
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('retention_period', ?)", String(retention_period));
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('storage_path', ?)", storage_path);

    console.log(`System settings updated. Duration: ${segment_duration}s, Retention: ${retention_period} days, Path: ${storage_path}`);

    // If critical recording settings changed, restart all active camera recorders
    if (pathChanged || durationChanged) {
      console.log('Recording parameters changed. Restarting all enabled cameras...');
      await ffmpegManager.stopAll();
      
      // Small timeout to allow processes to close
      setTimeout(async () => {
        await ffmpegManager.startAllEnabledCameras();
      }, 2000);
    }

    res.json({ message: 'Settings saved successfully. Services updated.' });
  } catch (err: any) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
