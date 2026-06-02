"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const os_1 = __importDefault(require("os"));
const database_1 = require("../db/database");
const auth_1 = require("../middleware/auth");
const storage_manager_1 = require("../services/storage-manager");
const ffmpeg_manager_1 = require("../services/ffmpeg-manager");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const storageManager = storage_manager_1.StorageManager.getInstance();
const ffmpegManager = ffmpeg_manager_1.FFmpegManager.getInstance();
// Secure all routes in this file
router.use(auth_1.authenticateJWT);
// GET /api/system/status - Get system metrics (CPU, Memory, Camera states)
router.get('/status', async (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        // CPU load average (1 min, 5 min, 15 min)
        const loadavg = os_1.default.loadavg();
        // Memory usage
        const totalMem = os_1.default.totalmem();
        const freeMem = os_1.default.freemem();
        const usedMem = totalMem - freeMem;
        const memoryUsagePercent = (usedMem / totalMem) * 100;
        // Get count of cameras
        const cameras = await db.all('SELECT id, enabled FROM cameras');
        const totalCameras = cameras.length;
        const enabledCameras = cameras.filter((c) => c.enabled === 1).length;
        // Determine active processes
        let activeRecorders = 0;
        let activeStreams = 0;
        for (const camera of cameras) {
            if (camera.enabled === 1) {
                const status = ffmpegManager.getCameraStatus(camera.id);
                if (status.recording)
                    activeRecorders++;
                if (status.online)
                    activeStreams++;
            }
        }
        res.json({
            uptime: process.uptime(), // seconds
            osUptime: os_1.default.uptime(), // seconds
            cpuLoad: loadavg[0], // 1-minute load average
            cpuCores: os_1.default.cpus().length,
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
    }
    catch (err) {
        console.error('System status error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/system/storage - Get disk space statistics
router.get('/storage', async (req, res) => {
    try {
        const stats = await storageManager.getStorageStats();
        res.json(stats);
    }
    catch (err) {
        console.error('System storage error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/system/settings - Get system configuration settings
router.get('/settings', async (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const settingsRows = await db.all('SELECT * FROM settings');
        const settings = {};
        for (const row of settingsRows) {
            settings[row.key] = row.value;
        }
        res.json({
            segment_duration: parseInt(settings.segment_duration || '300', 10),
            retention_period: parseInt(settings.retention_period || '7', 10),
            storage_path: settings.storage_path || ''
        });
    }
    catch (err) {
        console.error('Fetch settings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
const settingsSchema = zod_1.z.object({
    segment_duration: zod_1.z.number().int().min(10, 'Segment must be at least 10 seconds').max(3600, 'Segment cannot exceed 1 hour'),
    retention_period: zod_1.z.number().int().min(1, 'Retention must be at least 1 day').max(365, 'Retention cannot exceed 1 year'),
    storage_path: zod_1.z.string().min(1, 'Storage path is required')
});
// PUT /api/system/settings - Update system settings (Admin only)
router.put('/settings', (0, auth_1.requireRole)(['admin']), async (req, res) => {
    try {
        const parseResult = settingsSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error.errors[0].message });
        }
        const { segment_duration, retention_period, storage_path } = parseResult.data;
        const db = (0, database_1.getDb)();
        // Fetch existing settings to see if they changed
        const currentSettings = await db.all('SELECT * FROM settings');
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
    }
    catch (err) {
        console.error('Update settings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
