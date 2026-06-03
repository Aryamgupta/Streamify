import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getDb } from '../db/database';
import { CONFIG } from '../config';
import { authenticateJWT, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Configure storage location relative to DB path so it automatically persists in Docker / local data directories
const getUploadDirectory = () => {
  const dbDir = path.dirname(CONFIG.DB_PATH);
  const uploadDir = path.join(dbDir, 'uploads', 'faces');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, getUploadDirectory());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `face-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, JPG, and PNG images are allowed'));
    }
  }
});

// Protect all endpoints in this file
router.use(authenticateJWT);

// GET /api/faces - List all registered face profiles
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const faces = await db.all('SELECT id, name, details, image_path, embedding IS NOT NULL as trained, created_at FROM faces ORDER BY created_at DESC');
    res.json(faces);
  } catch (err) {
    console.error('List faces error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/faces - Register a new face profile with reference image
router.post('/', requireRole(['admin']), upload.single('image'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Reference image file is required' });
    }

    const { name, details } = req.body;
    if (!name || name.trim() === '') {
      // Clean up uploaded file if name is missing
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Name is required' });
    }

    // Save relative filename path so it works across host systems
    const relativeImagePath = path.basename(req.file.path);

    const db = getDb();
    const result = await db.run(
      'INSERT INTO faces (name, details, image_path, embedding) VALUES (?, ?, ?, NULL)',
      name.trim(),
      details ? details.trim() : null,
      relativeImagePath
    );

    res.status(201).json({
      id: result.lastID,
      name: name.trim(),
      details: details ? details.trim() : null,
      image_path: relativeImagePath,
      trained: false,
      message: 'Face profile created. Embbedings will be processed shortly by the AI background service.'
    });
  } catch (err: any) {
    console.error('Create face error:', err);
    // Cleanup file on error if uploaded
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// DELETE /api/faces/:id - Delete a registered face profile
router.delete('/:id', requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb();
    const faceId = parseInt(req.params.id, 10);
    
    // Get file info first to delete image from disk
    const face = await db.get<{ image_path: string }>('SELECT image_path FROM faces WHERE id = ?', faceId);
    if (!face) {
      return res.status(404).json({ error: 'Face profile not found' });
    }

    // Remove database entry
    await db.run('DELETE FROM faces WHERE id = ?', faceId);

    // Delete image file from disk
    const dbDir = path.dirname(CONFIG.DB_PATH);
    const fullPath = path.join(dbDir, 'uploads', 'faces', face.image_path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    res.json({ message: 'Face profile and files deleted successfully.' });
  } catch (err) {
    console.error('Delete face error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
