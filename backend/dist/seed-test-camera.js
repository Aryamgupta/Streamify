"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("./db/database");
const config_1 = require("./config");
const path_1 = __importDefault(require("path"));
async function seed() {
    try {
        console.log('Initializing database link...');
        await (0, database_1.initDatabase)(config_1.CONFIG.DB_PATH);
        const db = (0, database_1.getDb)();
        // Check if mock camera already exists
        const existing = await db.get('SELECT id FROM cameras WHERE name = ?', 'Mock Test Camera');
        if (existing) {
            console.log('Mock Test Camera already exists in DB.');
            process.exit(0);
        }
        const mockVideoPath = path_1.default.resolve(__dirname, '../../mock-media/test.mp4');
        console.log(`Mock video file resolved to: ${mockVideoPath}`);
        // Insert mock camera
        await db.run('INSERT INTO cameras (name, rtsp_url, enabled) VALUES (?, ?, ?)', 'Mock Test Camera', mockVideoPath, 1);
        console.log('Mock Test Camera seeded successfully into database!');
        process.exit(0);
    }
    catch (err) {
        console.error('Failed to seed camera:', err);
        process.exit(1);
    }
}
seed();
