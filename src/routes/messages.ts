import express from 'express';
import db, { type MessageRow, type UserRow } from '../db';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as UserRow | undefined;
  if (!user?.thread_id) {
    return res.status(400).json({ error: 'You’re not connected with a partner yet.' });
  }

  const beforeValue = Array.isArray(req.query.before) ? req.query.before[0] : req.query.before;
  const before = typeof beforeValue === 'string' ? Number.parseInt(beforeValue, 10) : null;
  const limit = 50;

  const rows = before
    ? (db.prepare(`
        SELECT * FROM messages
        WHERE thread_id = ? AND id < ?
        ORDER BY id DESC LIMIT ?
      `).all(user.thread_id, before, limit) as MessageRow[])
    : (db.prepare(`
        SELECT * FROM messages
        WHERE thread_id = ?
        ORDER BY id DESC LIMIT ?
      `).all(user.thread_id, limit) as MessageRow[]);

  res.json({
    messages: rows.reverse().map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      createdAt: m.created_at,
    })),
  });
});

export default router;