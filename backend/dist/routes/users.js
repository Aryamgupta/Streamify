"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../db/database");
const auth_1 = require("../middleware/auth");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
// Secure all routes in this file
router.use(auth_1.authenticateJWT);
router.use((0, auth_1.requireRole)(['admin']));
const createUserSchema = zod_1.z.object({
    username: zod_1.z.string().min(3, 'Username must be at least 3 characters'),
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters'),
    role: zod_1.z.enum(['admin', 'viewer'])
});
const updateUserSchema = zod_1.z.object({
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters').optional(),
    role: zod_1.z.enum(['admin', 'viewer']).optional()
});
// GET /api/users
router.get('/', async (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const users = await db.all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
        res.json(users);
    }
    catch (err) {
        console.error('Fetch users error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/users
router.post('/', async (req, res) => {
    try {
        const parseResult = createUserSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error.errors[0].message });
        }
        const { username, password, role } = parseResult.data;
        const db = (0, database_1.getDb)();
        // Check if user already exists
        const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
        if (existingUser) {
            return res.status(409).json({ error: 'Username already taken' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const result = await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', username, passwordHash, role);
        res.status(201).json({
            id: result.lastID,
            username,
            role,
            message: 'User created successfully'
        });
    }
    catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PUT /api/users/:id
router.put('/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const parseResult = updateUserSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error.errors[0].message });
        }
        const { password, role } = parseResult.data;
        const db = (0, database_1.getDb)();
        // Check if user exists
        const user = await db.get('SELECT username FROM users WHERE id = ?', userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Do not allow deleting or changing role of the primary 'admin' user if they are editing themselves
        if (user.username === 'admin' && role && role !== 'admin') {
            return res.status(400).json({ error: 'Cannot change the role of the primary admin user' });
        }
        if (password) {
            const passwordHash = await bcryptjs_1.default.hash(password, 10);
            await db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, userId);
        }
        if (role) {
            await db.run('UPDATE users SET role = ? WHERE id = ?', role, userId);
        }
        res.json({ message: 'User updated successfully' });
    }
    catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const db = (0, database_1.getDb)();
        // Prevent deleting the primary admin or currently logged-in user
        const user = await db.get('SELECT username FROM users WHERE id = ?', userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.username === 'admin') {
            return res.status(400).json({ error: 'Cannot delete the primary admin account' });
        }
        if (req.user && req.user.id === userId) {
            return res.status(400).json({ error: 'Cannot delete your own account while logged in' });
        }
        await db.run('DELETE FROM users WHERE id = ?', userId);
        res.json({ message: 'User deleted successfully' });
    }
    catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
