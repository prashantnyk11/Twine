const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Fetch message history for the caller's thread (most recent first, paginated)
router.get('/', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user.thread_id) {
    return res.status(400).json({ error: 'You\u2019re not connected with a partner yet.' });
  }

  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const limit = 50;

  const rows = before
    ? db.prepare(`
        SELECT * FROM messages
        WHERE thread_id = ? AND id < ?
        ORDER BY id DESC LIMIT ?
      `).all(user.thread_id, before, limit)
    : db.prepare(`
        SELECT * FROM messages
        WHERE thread_id = ?
        ORDER BY id DESC LIMIT ?
      `).all(user.thread_id, limit);

  res.json({
    messages: rows.reverse().map(m => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      createdAt: m.created_at,
    })),
  });
});

module.exports = router;
