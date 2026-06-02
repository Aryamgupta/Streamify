import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';
import { FFmpegManager } from '../services/ffmpeg-manager';
import { z } from 'zod';

const router = Router();
const ffmpegManager = FFmpegManager.getInstance();

// Secure all routes in this file
router.use(authenticateJWT);

const cameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required'),
  rtsp_url: z.string().min(1, 'RTSP/Source URL is required'),
  enabled: z.number().int().min(0).max(1).optional().default(1)
});

const testSchema = z.object({
  rtsp_url: z.string().min(1, 'Source URL is required')
});

// POST /api/cameras/test - Test stream connectivity
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = testSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { rtsp_url } = parseResult.data;
    const online = await ffmpegManager.testConnection(rtsp_url);
    res.json({ online });
  } catch (err: any) {
    console.error('Test connection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cameras - List all cameras with status
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const cameras = await db.all<{ id: number; name: string; rtsp_url: string; enabled: number; created_at: string }[]>(
      'SELECT * FROM cameras ORDER BY created_at DESC'
    );

    const camerasWithStatus = cameras.map((camera) => {
      const status = ffmpegManager.getCameraStatus(camera.id);
      return {
        ...camera,
        online: status.online,
        recording: status.recording
      };
    });

    res.json(camerasWithStatus);
  } catch (err: any) {
    console.error('Fetch cameras error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cameras - Add a new camera
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = cameraSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { name, rtsp_url, enabled } = parseResult.data;
    const skipTest = req.body.skipTest === true;

    // Verify connection before saving (unless skipped)
    if (!skipTest && enabled === 1) {
      const online = await ffmpegManager.testConnection(rtsp_url);
      if (!online) {
        return res.status(400).json({ error: 'RTSP connection test failed. Verify URL and credentials.' });
      }
    }

    const db = getDb();
    const result = await db.run(
      'INSERT INTO cameras (name, rtsp_url, enabled) VALUES (?, ?, ?)',
      name,
      rtsp_url,
      enabled
    );

    const cameraId = result.lastID!;

    // Start background processes if enabled
    if (enabled === 1) {
      await ffmpegManager.startCamera(cameraId);
    }

    res.status(201).json({
      id: cameraId,
      name,
      rtsp_url,
      enabled,
      message: 'Camera created successfully'
    });
  } catch (err: any) {
    console.error('Create camera error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/cameras/:id - Edit a camera
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cameraId = parseInt(req.params.id, 10);
    const parseResult = cameraSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { name, rtsp_url, enabled } = parseResult.data;
    const skipTest = req.body.skipTest === true;
    const db = getDb();

    // Check if camera exists
    const existing = await db.get<{ id: number; rtsp_url: string; enabled: number }>(
      'SELECT * FROM cameras WHERE id = ?',
      cameraId
    );

    if (!existing) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    // Verify connection if url changed and enabled (unless skipped)
    if (!skipTest && enabled === 1 && (existing.rtsp_url !== rtsp_url || existing.enabled !== enabled)) {
      const online = await ffmpegManager.testConnection(rtsp_url);
      if (!online) {
        return res.status(400).json({ error: 'RTSP connection test failed. Verify URL and credentials.' });
      }
    }

    await db.run(
      'UPDATE cameras SET name = ?, rtsp_url = ?, enabled = ? WHERE id = ?',
      name,
      rtsp_url,
      enabled,
      cameraId
    );

    // Dynamic process control
    if (enabled === 1) {
      // If URL changed or it was disabled before, start/restart it
      if (existing.enabled === 0 || existing.rtsp_url !== rtsp_url) {
        await ffmpegManager.startCamera(cameraId);
      }
    } else {
      // Stop processes if disabled
      await ffmpegManager.stopCamera(cameraId);
    }

    res.json({
      id: cameraId,
      name,
      rtsp_url,
      enabled,
      message: 'Camera updated successfully'
    });
  } catch (err: any) {
    console.error('Update camera error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cameras/:id - Delete a camera
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cameraId = parseInt(req.params.id, 10);
    const db = getDb();

    // Check if camera exists
    const existing = await db.get('SELECT id FROM cameras WHERE id = ?', cameraId);
    if (!existing) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    // 1. Stop background processes
    await ffmpegManager.stopCamera(cameraId);

    // 2. Delete from DB (recordings will cascade-delete if schema set up, let's also delete files)
    const recordings = await db.all<{ file_path: string }[]>('SELECT file_path FROM recordings WHERE camera_id = ?', cameraId);
    for (const rec of recordings) {
      try {
        if (require('fs').existsSync(rec.file_path)) {
          require('fs').unlinkSync(rec.file_path);
        }
      } catch (err) {
        console.error(`Error deleting file ${rec.file_path}:`, err);
      }
    }

    await db.run('DELETE FROM cameras WHERE id = ?', cameraId);

    res.json({ message: 'Camera and its recordings deleted successfully' });
  } catch (err: any) {
    console.error('Delete camera error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
