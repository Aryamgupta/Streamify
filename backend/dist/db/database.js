"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.getDb = getDb;
const sqlite_1 = require("sqlite");
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
let db;
async function initDatabase(dbPath) {
    const dbDir = path_1.default.dirname(dbPath);
    if (!fs_1.default.existsSync(dbDir)) {
        fs_1.default.mkdirSync(dbDir, { recursive: true });
    }
    db = await (0, sqlite_1.open)({
        filename: dbPath,
        driver: sqlite3_1.default.Database
    });
    // Enable foreign key support
    await db.run('PRAGMA foreign_keys = ON;');
    // Users table
    await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'viewer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    // Cameras table
    await db.exec(`
    CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rtsp_url TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    // Recordings table
    await db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id INTEGER NOT NULL,
      file_path TEXT UNIQUE NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      size INTEGER NOT NULL,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );
  `);
    // Settings key-value table
    await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
    // Seed default admin user if no users exist
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    if (userCount && userCount.count === 0) {
        const passwordHash = await bcryptjs_1.default.hash('admin123', 10);
        await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', 'admin', passwordHash, 'admin');
        console.log('Seeded default admin user: admin / admin123');
    }
    // Seed default settings if empty
    const settingsCount = await db.get('SELECT COUNT(*) as count FROM settings');
    if (settingsCount && settingsCount.count === 0) {
        await db.run("INSERT INTO settings (key, value) VALUES ('segment_duration', '300')");
        await db.run("INSERT INTO settings (key, value) VALUES ('retention_period', '7')");
        // Default storage path is in workspace/recordings
        const defaultStoragePath = path_1.default.resolve(__dirname, '../../../recordings');
        await db.run("INSERT INTO settings (key, value) VALUES ('storage_path', ?)", defaultStoragePath);
        console.log('Seeded default system settings');
    }
    return db;
}
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase first.');
    }
    return db;
}
