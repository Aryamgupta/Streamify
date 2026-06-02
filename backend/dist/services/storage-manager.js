"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const database_1 = require("../db/database");
class StorageManager {
    static instance;
    cleanupInterval = null;
    isCleaning = false;
    constructor() {
        // Run cleanup check every 6 hours
        this.cleanupInterval = setInterval(() => {
            this.runCleanup();
        }, 6 * 60 * 60 * 1000);
    }
    static getInstance() {
        if (!StorageManager.instance) {
            StorageManager.instance = new StorageManager();
        }
        return StorageManager.instance;
    }
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    async getStoragePath() {
        const db = (0, database_1.getDb)();
        const setting = await db.get("SELECT value FROM settings WHERE key = 'storage_path'");
        return setting ? setting.value : path_1.default.resolve(__dirname, '../../../recordings');
    }
    async getRetentionPeriodDays() {
        const db = (0, database_1.getDb)();
        const setting = await db.get("SELECT value FROM settings WHERE key = 'retention_period'");
        return setting ? parseInt(setting.value, 10) : 7;
    }
    /**
     * Get disk usage statistics using Node's fs.statfsSync
     */
    async getStorageStats() {
        const storagePath = await this.getStoragePath();
        // Ensure path exists to query it
        if (!fs_1.default.existsSync(storagePath)) {
            fs_1.default.mkdirSync(storagePath, { recursive: true });
        }
        try {
            const stats = fs_1.default.statfsSync(storagePath);
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
        }
        catch (err) {
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
    async runCleanup() {
        if (this.isCleaning)
            return;
        this.isCleaning = true;
        try {
            const db = (0, database_1.getDb)();
            const retentionDays = await this.getRetentionPeriodDays();
            // Calculate cutoff time in ISO format
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            const cutoffStr = cutoffDate.toISOString();
            console.log(`Running retention cleanup. Deleting recordings older than ${retentionDays} days (before ${cutoffStr})...`);
            // Get expired recordings
            const expiredRecordings = await db.all('SELECT id, file_path FROM recordings WHERE start_time < ?', cutoffStr);
            console.log(`Found ${expiredRecordings.length} expired recording segments.`);
            let deletedCount = 0;
            for (const recording of expiredRecordings) {
                try {
                    // 1. Delete file from disk if it exists
                    if (fs_1.default.existsSync(recording.file_path)) {
                        fs_1.default.unlinkSync(recording.file_path);
                    }
                    // 2. Delete database entry
                    await db.run('DELETE FROM recordings WHERE id = ?', recording.id);
                    deletedCount++;
                }
                catch (fileErr) {
                    console.error(`Error deleting file ${recording.file_path}:`, fileErr);
                    // Still try to delete database entry if file doesn't exist
                    if (!fs_1.default.existsSync(recording.file_path)) {
                        await db.run('DELETE FROM recordings WHERE id = ?', recording.id);
                        deletedCount++;
                    }
                }
            }
            console.log(`Successfully cleaned up ${deletedCount} recording segments.`);
            // 3. Clean up empty date directories to keep storage tidy
            await this.cleanEmptyDirectories();
        }
        catch (err) {
            console.error('Retention cleanup failed:', err);
        }
        finally {
            this.isCleaning = false;
        }
    }
    /**
     * Remove empty YYYY-MM-DD directories in storage path
     */
    async cleanEmptyDirectories() {
        try {
            const storagePath = await this.getStoragePath();
            if (!fs_1.default.existsSync(storagePath))
                return;
            const formatDate = (d) => {
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            };
            const today = formatDate(new Date());
            const tomorrow = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
            const cameras = fs_1.default.readdirSync(storagePath);
            for (const camDir of cameras) {
                const camPath = path_1.default.join(storagePath, camDir);
                if (!fs_1.default.statSync(camPath).isDirectory())
                    continue;
                const dateFolders = fs_1.default.readdirSync(camPath);
                for (const dateFolder of dateFolders) {
                    if (dateFolder === today || dateFolder === tomorrow) {
                        continue; // Keep directories for active and upcoming recording sessions
                    }
                    const dateFolderPath = path_1.default.join(camPath, dateFolder);
                    if (!fs_1.default.statSync(dateFolderPath).isDirectory())
                        continue;
                    // Check if folder is empty
                    const files = fs_1.default.readdirSync(dateFolderPath);
                    if (files.length === 0) {
                        fs_1.default.rmdirSync(dateFolderPath);
                        console.log(`Removed empty date folder: ${camDir}/${dateFolder}`);
                    }
                }
            }
        }
        catch (err) {
            console.error('Error cleaning empty directories:', err);
        }
    }
}
exports.StorageManager = StorageManager;
