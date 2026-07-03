const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'twine.db'));
db.pragma('journal_mode = WAL');

// --- Schema -----------------------------------------------------------
// users: individual accounts
// threads: a "thread" is the private connection between exactly two users
// messages: belong to a thread, sent by one of the two users in it
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

module.exports = db;
