import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/database';
import { authenticateJWT, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// Secure all routes in this file
router.use(authenticateJWT);
router.use(requireRole(['admin']));

const createUserSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['admin', 'viewer'])
});

const updateUserSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
  role: z.enum(['admin', 'viewer']).optional()
});

// GET /api/users
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const users = await db.all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err: any) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { username, password, role } = parseResult.data;
    const db = getDb();

    // Check if user already exists
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      username,
      passwordHash,
      role
    );

    res.status(201).json({
      id: result.lastID,
      username,
      role,
      message: 'User created successfully'
    });
  } catch (err: any) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const parseResult = updateUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { password, role } = parseResult.data;
    const db = getDb();

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
      const passwordHash = await bcrypt.hash(password, 10);
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, userId);
    }

    if (role) {
      await db.run('UPDATE users SET role = ? WHERE id = ?', role, userId);
    }

    res.json({ message: 'User updated successfully' });
  } catch (err: any) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const db = getDb();

    // Prevent deleting the primary admin or currently logged-in user
    const user = await db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', userId);
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
  } catch (err: any) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
