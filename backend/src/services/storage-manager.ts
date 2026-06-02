import fs from 'fs';
import path from 'path';
import { getDb } from '../db/database';

export class StorageManager {
  private static instance: StorageManager;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isCleaning = false;

  private constructor() {
    // Run cleanup check every 6 hours
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, 6 * 60 * 60 * 1000);
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async getStoragePath(): Promise<string> {
    const db = getDb();
    const setting = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'storage_path'");
    return setting ? setting.value : path.resolve(__dirname, '../../../recordings');
  }

  private async getRetentionPeriodDays(): Promise<number> {
    const db = getDb();
    const setting = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'retention_period'");
    return setting ? parseInt(setting.value, 10) : 7;
  }

  /**
   * Get disk usage statistics using Node's fs.statfsSync
   */
  public async getStorageStats() {
    const storagePath = await this.getStoragePath();
    
    // Ensure path exists to query it
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    try {
      const stats = fs.statfsSync(storagePath);
      const total = stats.bsize * stats.blocks;
      const free = stats.bsize * stats.bavail;
      const used = total - free;
      const percentUsed = total > 0 ? (used / total) * 100 : 0;

      return {
        total,
        free,
        used,
        percentUsed,
        alert: percentUsed >= 90.0,
        storagePath
      };
    } catch (err) {
      console.error('Error fetching storage stats:', err);
      // Fallback
      return {
        total: 0,
        free: 0,
        used: 0,
        percentUsed: 0,
        alert: false,
        storagePath
      };
    }
  }

  /**
   * Run retention cleanup: delete recording segments older than retention_period days
   */
  public async runCleanup() {
    if (this.isCleaning) return;
    this.isCleaning = true;

    try {
      const db = getDb();
      const retentionDays = await this.getRetentionPeriodDays();
      
      // Calculate cutoff time in ISO format
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffStr = cutoffDate.toISOString();

      console.log(`Running retention cleanup. Deleting recordings older than ${retentionDays} days (before ${cutoffStr})...`);

      // Get expired recordings
      const expiredRecordings = await db.all<{ id: number; file_path: string }>(
        'SELECT id, file_path FROM recordings WHERE start_time < ?',
        cutoffStr
      );

      console.log(`Found ${expiredRecordings.length} expired recording segments.`);

      let deletedCount = 0;
      for (const recording of expiredRecordings) {
        try {
          // 1. Delete file from disk if it exists
          if (fs.existsSync(recording.file_path)) {
            fs.unlinkSync(recording.file_path);
          }
          
          // 2. Delete database entry
          await db.run('DELETE FROM recordings WHERE id = ?', recording.id);
          deletedCount++;
        } catch (fileErr) {
          console.error(`Error deleting file ${recording.file_path}:`, fileErr);
          // Still try to delete database entry if file doesn't exist
          if (!fs.existsSync(recording.file_path)) {
            await db.run('DELETE FROM recordings WHERE id = ?', recording.id);
            deletedCount++;
          }
        }
      }

      console.log(`Successfully cleaned up ${deletedCount} recording segments.`);

      // 3. Clean up empty date directories to keep storage tidy
      await this.cleanEmptyDirectories();

    } catch (err) {
      console.error('Retention cleanup failed:', err);
    } finally {
      this.isCleaning = false;
    }
  }

  /**
   * Remove empty YYYY-MM-DD directories in storage path
   */
  private async cleanEmptyDirectories() {
    try {
      const storagePath = await this.getStoragePath();
      if (!fs.existsSync(storagePath)) return;

      const cameras = fs.readdirSync(storagePath);
      for (const camDir of cameras) {
        const camPath = path.join(storagePath, camDir);
        if (!fs.statSync(camPath).isDirectory()) continue;

        const dateFolders = fs.readdirSync(camPath);
        for (const dateFolder of dateFolders) {
          const dateFolderPath = path.join(camPath, dateFolder);
          if (!fs.statSync(dateFolderPath).isDirectory()) continue;

          // Check if folder is empty
          const files = fs.readdirSync(dateFolderPath);
          if (files.length === 0) {
            fs.rmdirSync(dateFolderPath);
            console.log(`Removed empty date folder: ${camDir}/${dateFolder}`);
          }
        }
      }
    } catch (err) {
      console.error('Error cleaning empty directories:', err);
    }
  }
}
