import path from 'path';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { Server, type Socket } from 'socket.io';
import db, { type UserRow } from './db';
import authRoutes from './routes/auth';
import messageRoutes from './routes/messages';

if (!process.env.JWT_SECRET) {
  console.error('\nMissing JWT_SECRET. Copy .env.example to .env and set a value before starting the server.\n');
  process.exit(1);
}

interface SessionPayload extends JwtPayload {
  userId: number;
}

interface MessagePayload {
  body?: string;
}

interface MessageResponse {
  error?: string;
  message?: {
    id: number;
    senderId: number;
    body: string;
    createdAt: string;
  };
}

interface AuthedSocket extends Socket {
  userId: number;
  threadId: number;
}

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

const onlineByThread = new Map<number, Set<number>>();

function getUser(userId: number) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
}

io.use((socket, next) => {
  try {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) {
      return next(new Error('unauthorized'));
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET) as SessionPayload;
    if (typeof payload.userId !== 'number') {
      return next(new Error('unauthorized'));
    }

    const user = getUser(payload.userId);
    if (!user) {
      return next(new Error('unauthorized'));
    }
    if (!user.thread_id) {
      return next(new Error('not_paired'));
    }

    const authedSocket = socket as AuthedSocket;
    authedSocket.userId = user.id;
    authedSocket.threadId = user.thread_id;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const authedSocket = socket as AuthedSocket;
  const room = `thread:${authedSocket.threadId}`;
  authedSocket.join(room);

  if (!onlineByThread.has(authedSocket.threadId)) {
    onlineByThread.set(authedSocket.threadId, new Set());
  }
  onlineByThread.get(authedSocket.threadId)?.add(authedSocket.userId);

  authedSocket.to(room).emit('presence', { userId: authedSocket.userId, online: true });
  const others = Array.from(onlineByThread.get(authedSocket.threadId) ?? []).filter((id) => id !== authedSocket.userId);
  authedSocket.emit('presence:snapshot', { onlineUserIds: others });

  authedSocket.on('message:send', (payload: MessagePayload, ack?: (response: MessageResponse) => void) => {
    const body = (payload?.body || '').toString().trim();
    if (!body) {
      ack?.({ error: 'Message is empty.' });
      return;
    }
    if (body.length > 4000) {
      ack?.({ error: 'Message is too long.' });
      return;
    }

    const info = db.prepare(`
      INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?)
    `).run(authedSocket.threadId, authedSocket.userId, body);

    const message = {
      id: Number(info.lastInsertRowid),
      senderId: authedSocket.userId,
      body,
      createdAt: new Date().toISOString(),
    };

    io.to(room).emit('message:new', message);
    ack?.({ message });
  });

  authedSocket.on('typing', (isTyping) => {
    authedSocket.to(room).emit('typing', { userId: authedSocket.userId, isTyping: !!isTyping });
  });

  authedSocket.on('disconnect', () => {
    const set = onlineByThread.get(authedSocket.threadId);
    if (set) {
      set.delete(authedSocket.userId);
      if (set.size === 0) {
        onlineByThread.delete(authedSocket.threadId);
      }
    }
    authedSocket.to(room).emit('presence', { userId: authedSocket.userId, online: false });
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Twine is running at http://localhost:${PORT}`);
});