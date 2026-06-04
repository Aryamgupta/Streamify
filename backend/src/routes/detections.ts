import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Store active Server-Sent Events (SSE) connections
let sseClients: Response[] = [];

// Broadcasts an alert payload to all connected frontend clients
export function broadcastDetectionAlert(alertData: any) {
  const payload = `data: ${JSON.stringify(alertData)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch (err) {
      console.error('Failed to write to SSE client:', err);
    }
  });
}

// GET /api/detections/alerts - SSE Endpoint for real-time dashboard notifications
router.get('/alerts', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Push connection to active list
  sseClients.push(res);
  console.log(`SSE Dashboard Client connected. Total clients: ${sseClients.length}`);

  // Ping client to keep connection alive
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients = sseClients.filter((c) => c !== res);
    console.log(`SSE Dashboard Client disconnected. Total clients: ${sseClients.length}`);
  });
});

// POST /api/detections/alert - Webhook endpoint for Python AI service to log detection events
// Note: Exclude authenticateJWT for the python microservice webhook, protect with a key instead
router.post('/alert', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.AI_API_KEY || 'streamify-ai-secret-key-change-this';

    if (apiKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized webhook access' });
    }

    const { camera_id, face_id, confidence, snapshot_path, people_count } = req.body;

    if (!camera_id) {
      return res.status(400).json({ error: 'camera_id is required' });
    }

    const db = getDb();

    // 1. Log people count if present
    if (typeof people_count === 'number') {
      await db.run(
        'INSERT INTO people_count_logs (camera_id, count) VALUES (?, ?)',
        camera_id,
        people_count
      );
    }

    // 2. Log face detection if present (face_id can be null for unknown/unrecognized)
    let loggedDetection = null;
    if (snapshot_path && typeof confidence === 'number') {
      const result = await db.run(
        'INSERT INTO face_detections (camera_id, face_id, confidence, snapshot_path) VALUES (?, ?, ?, ?)',
        camera_id,
        face_id || null,
        confidence,
        snapshot_path
      );

      // Fetch newly logged detection with relations for SSE broadcast
      loggedDetection = await db.get(`
        SELECT fd.id, fd.camera_id, c.name as camera_name, fd.face_id, 
               f.name as person_name, f.details as person_details, 
               fd.confidence, fd.snapshot_path, fd.timestamp
        FROM face_detections fd
        JOIN cameras c ON fd.camera_id = c.id
        LEFT JOIN faces f ON fd.face_id = f.id
        WHERE fd.id = ?
      `, result.lastID);
      
      // Broadcast real-time alert to UI
      if (loggedDetection) {
        broadcastDetectionAlert({
          type: 'face_detection',
          data: loggedDetection
        });
      }
    }

    res.status(200).json({ 
      success: true, 
      message: 'Alert processed successfully',
      detection: loggedDetection 
    });

  } catch (err: any) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Protect all remaining read endpoints with standard JWT
router.use(authenticateJWT);

// GET /api/detections - Paginated detection event logs
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const detections = await db.all(`
      SELECT fd.id, fd.camera_id, c.name as camera_name, fd.face_id, 
             f.name as person_name, f.details as person_details, 
             fd.confidence, fd.snapshot_path, fd.timestamp
      FROM face_detections fd
      JOIN cameras c ON fd.camera_id = c.id
      LEFT JOIN faces f ON fd.face_id = f.id
      ORDER BY fd.timestamp DESC
      LIMIT ? OFFSET ?
    `, limit, offset);

    const totalRows = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM face_detections');

    res.json({
      data: detections,
      pagination: {
        limit,
        offset,
        total: totalRows ? totalRows.count : 0
      }
    });
  } catch (err) {
    console.error('Fetch detections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/detections/people-count-logs - Paginated people count event logs
router.get('/people-count-logs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const logs = await db.all(`
      SELECT pcl.id, pcl.camera_id, c.name as camera_name, pcl.count, pcl.timestamp
      FROM people_count_logs pcl
      JOIN cameras c ON pcl.camera_id = c.id
      ORDER BY pcl.timestamp DESC
      LIMIT ? OFFSET ?
    `, limit, offset);

    const totalRows = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM people_count_logs');

    res.json({
      data: logs,
      pagination: {
        limit,
        offset,
        total: totalRows ? totalRows.count : 0
      }
    });
  } catch (err) {
    console.error('Fetch people count logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/detections/analytics/people-count - Fetch people counts over last 24h for charts
router.get('/analytics/people-count', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    
    // Fetch count points from last 24 hours
    const logs = await db.all(`
      SELECT pcl.camera_id, c.name as camera_name, pcl.count, pcl.timestamp
      FROM people_count_logs pcl
      JOIN cameras c ON pcl.camera_id = c.id
      WHERE pcl.timestamp >= datetime('now', '-24 hours')
      ORDER BY pcl.timestamp ASC
    `);

    res.json(logs);
  } catch (err) {
    console.error('Fetch people analytics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
