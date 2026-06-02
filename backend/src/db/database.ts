import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

let db: Database;

export async function initDatabase(dbPath: string): Promise<Database> {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
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
  const userCount = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
  if (userCount && userCount.count === 0) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await db.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      'admin',
      passwordHash,
      'admin'
    );
    console.log('Seeded default admin user: admin / admin123');
  }

  // Seed default settings if empty
  const settingsCount = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM settings');
  if (settingsCount && settingsCount.count === 0) {
    await db.run("INSERT INTO settings (key, value) VALUES ('segment_duration', '300')");
    await db.run("INSERT INTO settings (key, value) VALUES ('retention_period', '7')");
    // Default storage path is in workspace/recordings
    const defaultStoragePath = path.resolve(__dirname, '../../../recordings');
    await db.run("INSERT INTO settings (key, value) VALUES ('storage_path', ?)", defaultStoragePath);
    console.log('Seeded default system settings');
  }

  return db;
}

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}
