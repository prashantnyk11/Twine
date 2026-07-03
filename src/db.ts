import Database from 'better-sqlite3';
import path from 'path';

export interface UserRow {
  id: number;
  display_name: string;
  email: string;
  password_hash: string;
  invite_code: string;
  thread_id: number | null;
  created_at: string;
}

export interface ThreadRow {
  id: number;
  user_a_id: number;
  user_b_id: number;
  created_at: string;
}

export interface MessageRow {
  id: number;
  thread_id: number;
  sender_id: number;
  body: string;
  created_at: string;
}

const db = new Database(path.join(process.cwd(), 'twine.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name  TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    invite_code   TEXT NOT NULL UNIQUE,
    thread_id     INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS threads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a_id    INTEGER NOT NULL,
    user_b_id    INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_a_id) REFERENCES users(id),
    FOREIGN KEY (user_b_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id   INTEGER NOT NULL,
    sender_id   INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES threads(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
`);

export default db;