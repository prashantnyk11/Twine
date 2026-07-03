import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db, { type ThreadRow, type UserRow } from '../db';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

interface PublicUser {
  id: number;
  displayName: string;
  email: string;
  inviteCode: string;
  threadId: number | null;
}

interface PartnerSummary {
  id: number;
  displayName: string;
}

interface RegisterBody {
  displayName?: string;
  email?: string;
  password?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

interface PairRedeemBody {
  code?: string;
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Missing JWT_SECRET.');
  }
  return secret;
}

function makeInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

function signToken(userId: number) {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '30d' });
}

function publicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    inviteCode: user.invite_code,
    threadId: user.thread_id,
  };
}

router.post('/register', (req, res) => {
  const { displayName, email, password } = (req.body || {}) as RegisterBody;

  if (!displayName || !displayName.trim()) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail) as { id: number } | undefined;
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const inviteCode = makeInviteCode();

  const info = db.prepare(`
    INSERT INTO users (display_name, email, password_hash, invite_code)
    VALUES (?, ?, ?, ?)
  `).run(displayName.trim(), normalizedEmail, passwordHash, inviteCode);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
  const token = signToken(user.id);
  res.json({ token, user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = (req.body || {}) as LoginBody;
  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter your email and password.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signToken(user.id);
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as UserRow | undefined;
  if (!user) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  let partner: PartnerSummary | null = null;
  if (user.thread_id) {
    const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(user.thread_id) as ThreadRow | undefined;
    if (thread) {
      const partnerId = thread.user_a_id === user.id ? thread.user_b_id : thread.user_a_id;
      const p = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(partnerId) as { id: number; display_name: string } | undefined;
      partner = p ? { id: p.id, displayName: p.display_name } : null;
    }
  }

  res.json({ user: publicUser(user), partner });
});

router.post('/pair/redeem', requireAuth, (req, res) => {
  const { code } = (req.body || {}) as PairRedeemBody;
  if (!code) {
    return res.status(400).json({ error: 'Enter your partner’s connection code.' });
  }

  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as UserRow | undefined;
  if (!me) {
    return res.status(404).json({ error: 'Account not found.' });
  }
  if (me.thread_id) {
    return res.status(400).json({ error: 'You’re already connected with someone.' });
  }

  const normalized = code.trim().toUpperCase();
  const partner = db.prepare('SELECT * FROM users WHERE invite_code = ?').get(normalized) as UserRow | undefined;

  if (!partner) {
    return res.status(404).json({ error: 'That code doesn’t match anyone. Double-check it and try again.' });
  }
  if (partner.id === me.id) {
    return res.status(400).json({ error: 'That’s your own code — share it with your partner instead.' });
  }
  if (partner.thread_id) {
    return res.status(400).json({ error: 'That person is already connected with someone else.' });
  }

  const info = db.prepare('INSERT INTO threads (user_a_id, user_b_id) VALUES (?, ?)').run(me.id, partner.id);
  db.prepare('UPDATE users SET thread_id = ? WHERE id IN (?, ?)').run(info.lastInsertRowid, me.id, partner.id);

  res.json({ threadId: info.lastInsertRowid, partner: { id: partner.id, displayName: partner.display_name } });
});

router.post('/pair/unlink', requireAuth, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as UserRow | undefined;
  if (!me) {
    return res.status(404).json({ error: 'Account not found.' });
  }
  if (!me.thread_id) {
    return res.status(400).json({ error: 'You’re not connected with anyone yet.' });
  }

  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(me.thread_id) as ThreadRow | undefined;
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found.' });
  }

  db.prepare('UPDATE users SET thread_id = NULL WHERE id IN (?, ?)').run(thread.user_a_id, thread.user_b_id);

  res.json({ ok: true });
});

export default router;