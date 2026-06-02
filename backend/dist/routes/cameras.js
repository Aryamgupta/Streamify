"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const auth_1 = require("../middleware/auth");
const ffmpeg_manager_1 = require("../services/ffmpeg-manager");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const ffmpegManager = ffmpeg_manager_1.FFmpegManager.getInstance();
// Secure all routes in this file
router.use(auth_1.authenticateJWT);
const cameraSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Camera name is required'),
    rtsp_url: zod_1.z.string().min(1, 'RTSP/Source URL is required'),
    enabled: zod_1.z.number().int().min(0).max(1).optional().default(1)
});
const testSchema = zod_1.z.object({
    rtsp_url: zod_1.z.string().min(1, 'Source URL is required')
});
// POST /api/cameras/test - Test stream connectivity
router.post('/test', async (req, res) => {
    try {
        const parseResult = testSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error.errors[0].message });
        }
        const { rtsp_url } = parseResult.data;
        const online = await ffmpegManager.testConnection(rtsp_url);
        res.json({ online });
    }
    catch (err) {
        console.error('Test connection error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/cameras - List all cameras with status
router.get('/', async (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const cameras = await db.all('SELECT * FROM cameras ORDER BY created_at DESC');
        const camerasWithStatus = cameras.map((camera) => {
            const status = ffmpegManager.getCameraStatus(camera.id);
            return {
                ...camera,
                online: status.online,
                recording: status.recording
            };
        });
        res.json(camerasWithStatus);
    }
    catch (err) {
        console.error('Fetch cameras error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/cameras - Add a new camera
router.post('/', async (req, res) => {
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
        const db = (0, database_1.getDb)();
        const result = await db.run('INSERT INTO cameras (name, rtsp_url, enabled) VALUES (?, ?, ?)', name, rtsp_url, enabled);
        const cameraId = result.lastID;
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
    }
    catch (err) {
        console.error('Create camera error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PUT /api/cameras/:id - Edit a camera
router.put('/:id', async (req, res) => {
    try {
        const cameraId = parseInt(req.params.id, 10);
        const parseResult = cameraSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error.errors[0].message });
        }
        const { name, rtsp_url, enabled } = parseResult.data;
        const skipTest = req.body.skipTest === true;
        const db = (0, database_1.getDb)();
        // Check if camera exists
        const existing = await db.get('SELECT * FROM cameras WHERE id = ?', cameraId);
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
        await db.run('UPDATE cameras SET name = ?, rtsp_url = ?, enabled = ? WHERE id = ?', name, rtsp_url, enabled, cameraId);
        // Dynamic process control
        if (enabled === 1) {
            // If URL changed or it was disabled before, start/restart it
            if (existing.enabled === 0 || existing.rtsp_url !== rtsp_url) {
                await ffmpegManager.startCamera(cameraId);
            }
        }
        else {
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
    }
    catch (err) {
        console.error('Update camera error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /api/cameras/:id - Delete a camera
router.delete('/:id', async (req, res) => {
    try {
        const cameraId = parseInt(req.params.id, 10);
        const db = (0, database_1.getDb)();
        // Check if camera exists
        const existing = await db.get('SELECT id FROM cameras WHERE id = ?', cameraId);
        if (!existing) {
            return res.status(404).json({ error: 'Camera not found' });
        }
        // 1. Stop background processes
        await ffmpegManager.stopCamera(cameraId);
        // 2. Delete from DB (recordings will cascade-delete if schema set up, let's also delete files)
        const recordings = await db.all('SELECT file_path FROM recordings WHERE camera_id = ?', cameraId);
        for (const rec of recordings) {
            try {
                if (require('fs').existsSync(rec.file_path)) {
                    require('fs').unlinkSync(rec.file_path);
                }
            }
            catch (err) {
                console.error(`Error deleting file ${rec.file_path}:`, err);
            }
        }
        await db.run('DELETE FROM cameras WHERE id = ?', cameraId);
        res.json({ message: 'Camera and its recordings deleted successfully' });
    }
    catch (err) {
        console.error('Delete camera error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
