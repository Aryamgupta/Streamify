"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const auth_1 = require("../middleware/auth");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const router = (0, express_1.Router)();
// Secure all routes in this file
router.use(auth_1.authenticateJWT);
// GET /api/recordings - Fetch recordings with filters (camera_id, date)
router.get('/', async (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const cameraId = req.query.camera_id ? parseInt(req.query.camera_id, 10) : null;
        const date = req.query.date; // Expect YYYY-MM-DD
        let query = `
      SELECT r.*, c.name as camera_name 
      FROM recordings r
      JOIN cameras c ON r.camera_id = c.id
      WHERE 1=1
    `;
        const params = [];
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
    }
    catch (err) {
        console.error('Fetch recordings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/recordings/camera/:cameraId - Fetch recordings for a specific camera
router.get('/camera/:cameraId', async (req, res) => {
    try {
        const cameraId = parseInt(req.params.cameraId, 10);
        const db = (0, database_1.getDb)();
        const recordings = await db.all(`SELECT r.*, c.name as camera_name 
       FROM recordings r
       JOIN cameras c ON r.camera_id = c.id
       WHERE r.camera_id = ? 
       ORDER BY r.start_time DESC`, cameraId);
        res.json(recordings);
    }
    catch (err) {
        console.error('Fetch camera recordings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/recordings/video/:id - Play/stream/download a recording segment
router.get('/video/:id', async (req, res) => {
    try {
        const recordingId = parseInt(req.params.id, 10);
        const db = (0, database_1.getDb)();
        const recording = await db.get('SELECT file_path FROM recordings WHERE id = ?', recordingId);
        if (!recording) {
            return res.status(404).json({ error: 'Recording segment not found in database' });
        }
        const filePath = path_1.default.resolve(recording.file_path);
        if (!fs_1.default.existsSync(filePath)) {
            console.warn(`File recorded in DB but missing on disk: ${filePath}`);
            // Clean up database orphan entry
            await db.run('DELETE FROM recordings WHERE id = ?', recordingId);
            return res.status(404).json({ error: 'Recording file missing on disk' });
        }
        // Serve the file. Express handles range headers automatically for video seeking.
        res.sendFile(filePath);
    }
    catch (err) {
        console.error('Stream video segment error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
