const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function makeInviteCode() {
  // Short, easy to read aloud / text to a partner, e.g. "7K9-QX2"
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  let code;
  let exists = true;
  const check = db.prepare('SELECT id FROM users WHERE invite_code = ?');
  while (exists) {
    code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
    code = code.slice(0, 3) + '-' + code.slice(3);
    exists = !!check.get(code);
  }
  return code;
}

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    inviteCode: user.invite_code,
    threadId: user.thread_id,
  };
}

// --- Register -----------------------------------------------------------
router.post('/register', (req, res) => {
  const { displayName, email, password } = req.body || {};

  if (!displayName || !displayName.trim()) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const inviteCode = makeInviteCode();

  const info = db.prepare(`
    INSERT INTO users (display_name, email, password_hash, invite_code)
    VALUES (?, ?, ?, ?)
  `).run(displayName.trim(), email.toLowerCase(), passwordHash, inviteCode);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user.id);
  res.json({ token, user: publicUser(user) });
});

// --- Login ----------------------------------------------------------------
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter your email and password.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signToken(user.id);
  res.json({ token, user: publicUser(user) });
});

// --- Current user + partner info ------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  let partner = null;
  if (user.thread_id) {
    const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(user.thread_id);
    const partnerId = thread.user_a_id === user.id ? thread.user_b_id : thread.user_a_id;
    const p = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(partnerId);
    partner = p ? { id: p.id, displayName: p.display_name } : null;
  }

  res.json({ user: publicUser(user), partner });
});

// --- Pair with a partner using their invite code ---------------------------
router.post('/pair/redeem', requireAuth, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Enter your partner\u2019s connection code.' });

  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (me.thread_id) {
    return res.status(400).json({ error: 'You\u2019re already connected with someone.' });
  }

  const normalized = code.trim().toUpperCase();
  const partner = db.prepare('SELECT * FROM users WHERE invite_code = ?').get(normalized);

  if (!partner) return res.status(404).json({ error: 'That code doesn\u2019t match anyone. Double-check it and try again.' });
  if (partner.id === me.id) return res.status(400).json({ error: 'That\u2019s your own code \u2014 share it with your partner instead.' });
  if (partner.thread_id) return res.status(400).json({ error: 'That person is already connected with someone else.' });

  const info = db.prepare('INSERT INTO threads (user_a_id, user_b_id) VALUES (?, ?)').run(me.id, partner.id);
  db.prepare('UPDATE users SET thread_id = ? WHERE id IN (?, ?)').run(info.lastInsertRowid, me.id, partner.id);

  res.json({ threadId: info.lastInsertRowid, partner: { id: partner.id, displayName: partner.display_name } });
});

// --- Unlink from current partner --------------------------------------------
router.post('/pair/unlink', requireAuth, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!me.thread_id) return res.status(400).json({ error: 'You\u2019re not connected with anyone yet.' });

  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(me.thread_id);
  db.prepare('UPDATE users SET thread_id = NULL WHERE id IN (?, ?)').run(thread.user_a_id, thread.user_b_id);

  res.json({ ok: true });
});

module.exports = router;
