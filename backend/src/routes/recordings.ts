import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

const router = Router();

// Secure all routes in this file
router.use(authenticateJWT);

// GET /api/recordings - Fetch recordings with filters (camera_id, date)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const cameraId = req.query.camera_id ? parseInt(req.query.camera_id as string, 10) : null;
    const date = req.query.date as string | undefined; // Expect YYYY-MM-DD

    let query = `
      SELECT r.*, c.name as camera_name 
      FROM recordings r
      JOIN cameras c ON r.camera_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (cameraId !== null && !isNaN(cameraId)) {
      query += ' AND r.camera_id = ?';
      params.push(cameraId);
    }

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      query += " AND r.start_time LIKE ?";
      params.push(`${date}%`);
    }

    query += ' ORDER BY r.start_time DESC';

    const recordings = await db.all(query, ...params);
    res.json(recordings);
  } catch (err: any) {
    console.error('Fetch recordings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/recordings/camera/:cameraId - Fetch recordings for a specific camera
router.get('/camera/:cameraId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cameraId = parseInt(req.params.cameraId, 10);
    const db = getDb();

    const recordings = await db.all(
      `SELECT r.*, c.name as camera_name 
       FROM recordings r
       JOIN cameras c ON r.camera_id = c.id
       WHERE r.camera_id = ? 
       ORDER BY r.start_time DESC`,
      cameraId
    );

    res.json(recordings);
  } catch (err: any) {
    console.error('Fetch camera recordings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/recordings/video/:id - Play/stream/download a recording segment
router.get('/video/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const recordingId = parseInt(req.params.id, 10);
    const db = getDb();

    const recording = await db.get<{ file_path: string }>(
      'SELECT file_path FROM recordings WHERE id = ?',
      recordingId
    );

    if (!recording) {
      return res.status(404).json({ error: 'Recording segment not found in database' });
    }

    const filePath = path.resolve(recording.file_path);

    if (!fs.existsSync(filePath)) {
      console.warn(`File recorded in DB but missing on disk: ${filePath}`);
      // Clean up database orphan entry
      await db.run('DELETE FROM recordings WHERE id = ?', recordingId);
      return res.status(404).json({ error: 'Recording file missing on disk' });
    }

    // Serve the file. Express handles range headers automatically for video seeking.
    res.sendFile(filePath);
  } catch (err: any) {
    console.error('Stream video segment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
