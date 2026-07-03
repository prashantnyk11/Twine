require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const db = require('./db');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');

if (!process.env.JWT_SECRET) {
  console.error('\nMissing JWT_SECRET. Copy .env.example to .env and set a value before starting the server.\n');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- Real-time chat ---------------------------------------------------
// Track who is currently online per thread, in memory (fine for a 2-person room).
const onlineByThread = new Map(); // threadId -> Set of userId

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = getUser(payload.userId);
    if (!user) return next(new Error('unauthorized'));
    if (!user.thread_id) return next(new Error('not_paired'));
    socket.userId = user.id;
    socket.threadId = user.thread_id;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const room = `thread:${socket.threadId}`;
  socket.join(room);

  if (!onlineByThread.has(socket.threadId)) onlineByThread.set(socket.threadId, new Set());
  onlineByThread.get(socket.threadId).add(socket.userId);

  socket.to(room).emit('presence', { userId: socket.userId, online: true });
  // Let the newly-connected user know who else is online right now
  const others = [...onlineByThread.get(socket.threadId)].filter(id => id !== socket.userId);
  socket.emit('presence:snapshot', { onlineUserIds: others });

  socket.on('message:send', (payload, ack) => {
    const body = (payload?.body || '').toString().trim();
    if (!body) return ack?.({ error: 'Message is empty.' });
    if (body.length > 4000) return ack?.({ error: 'Message is too long.' });

    const info = db.prepare(`
      INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?)
    `).run(socket.threadId, socket.userId, body);

    const message = {
      id: info.lastInsertRowid,
      senderId: socket.userId,
      body,
      createdAt: new Date().toISOString(),
    };

    io.to(room).emit('message:new', message);
    ack?.({ message });
  });

  socket.on('typing', (isTyping) => {
    socket.to(room).emit('typing', { userId: socket.userId, isTyping: !!isTyping });
  });

  socket.on('disconnect', () => {
    const set = onlineByThread.get(socket.threadId);
    if (set) {
      set.delete(socket.userId);
      if (set.size === 0) onlineByThread.delete(socket.threadId);
    }
    socket.to(room).emit('presence', { userId: socket.userId, online: false });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Twine is running at http://localhost:${PORT}`);
});
