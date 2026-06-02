import { initDatabase, getDb } from './db/database';
import { CONFIG } from './config';
import path from 'path';

async function seed() {
  try {
    console.log('Initializing database link...');
    await initDatabase(CONFIG.DB_PATH);
    const db = getDb();

    // Check if mock camera already exists
    const existing = await db.get('SELECT id FROM cameras WHERE name = ?', 'Mock Test Camera');
    if (existing) {
      console.log('Mock Test Camera already exists in DB.');
      process.exit(0);
    }

    const mockVideoPath = path.resolve(__dirname, '../../mock-media/test.mp4');
    console.log(`Mock video file resolved to: ${mockVideoPath}`);

    // Insert mock camera
    await db.run(
      'INSERT INTO cameras (name, rtsp_url, enabled) VALUES (?, ?, ?)',
      'Mock Test Camera',
      mockVideoPath,
      1
    );

    console.log('Mock Test Camera seeded successfully into database!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed camera:', err);
    process.exit(1);
  }
}

seed();
