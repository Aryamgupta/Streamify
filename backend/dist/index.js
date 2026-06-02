"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const database_1 = require("./db/database");
const auth_1 = require("./middleware/auth");
const auth_2 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const cameras_1 = __importDefault(require("./routes/cameras"));
const recordings_1 = __importDefault(require("./routes/recordings"));
const system_1 = __importDefault(require("./routes/system"));
const ffmpeg_manager_1 = require("./services/ffmpeg-manager");
const storage_manager_1 = require("./services/storage-manager");
const app = (0, express_1.default)();
const ffmpegManager = ffmpeg_manager_1.FFmpegManager.getInstance();
const storageManager = storage_manager_1.StorageManager.getInstance();
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api/auth', auth_2.default);
app.use('/api/users', users_1.default);
app.use('/api/cameras', cameras_1.default);
app.use('/api/recordings', recordings_1.default);
app.use('/api/system', system_1.default);
// Protected static serving of live HLS video streams (playlists and chunks)
app.use('/live', auth_1.authenticateJWT, express_1.default.static(config_1.CONFIG.LIVE_PATH));
// Main startup function
async function bootstrap() {
    try {
        console.log('Initializing SQLite Database...');
        await (0, database_1.initDatabase)(config_1.CONFIG.DB_PATH);
        console.log(`Database initialized successfully at ${config_1.CONFIG.DB_PATH}`);
        // Start Express server
        const server = app.listen(config_1.CONFIG.PORT, '0.0.0.0', () => {
            console.log(`=========================================`);
            console.log(` CCTV NVR API Backend Running on port ${config_1.CONFIG.PORT} `);
            console.log(` Live Stream Directory: ${config_1.CONFIG.LIVE_PATH} `);
            console.log(` Mode: ${process.env.NODE_ENV || 'development'} `);
            console.log(`=========================================`);
        });
        // Graceful Shutdown Handler
        const shutdown = async (signal) => {
            console.log(`Received ${signal}. Starting graceful shutdown...`);
            server.close(() => {
                console.log('HTTP server closed.');
            });
            process.exit(0);
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }
    catch (err) {
        console.error('Fatal backend bootstrap error:', err);
        process.exit(1);
    }
}
bootstrap();
