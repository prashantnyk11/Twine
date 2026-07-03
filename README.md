# Twine

A private space for exactly two people to connect and talk — just you and your partner, no one else on the thread.

## What's inside

- **Backend:** Node.js + Express + Socket.io, with a SQLite database (via `better-sqlite3`) for accounts, pairing, and message history.
- **Frontend:** Plain HTML/CSS/JS (no build step) — a custom-designed three-screen flow: sign in, connect with your partner, and chat.
- **Auth:** Email + password, hashed with bcrypt, sessions via JWT.
- **Pairing:** Every account gets a private connection code (like `7K9-QX2`). Give it to your partner — when they redeem it, a private thread is created between the two of you and no one else can join it. Once two people are paired, that slot is closed; a third person cannot use either code.
- **Chat:** Real-time messaging over WebSockets (Socket.io), with typing indicators, online/offline presence, and persisted history you can scroll back through.

## 1. Install dependencies

```bash
cd twine
npm install
```

## 2. Configure your secret

```bash
cp .env.example .env
```

Then open `.env` and set `JWT_SECRET` to a long random string. You can generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Run it

```bash
npm start
```

Visit **http://localhost:3000**.

To try it out as a couple locally: open the site in two different browsers (or one normal + one incognito window), create two accounts, and pair them with each other's connection codes.

## How pairing works

1. Each person creates an account and gets a unique connection code.
2. One person shares their code with the other (text it, say it out loud, whatever works).
3. The other person enters that code on the "Connect your thread" screen.
4. A private thread is created between exactly those two accounts. Messages in that thread are only ever visible to the two of you.
5. Either person can unlink from the "⋯" menu in chat if you ever need to reset the connection.

## Project structure

```
twine/
├── server.js           # Express app + Socket.io real-time layer
├── db.js                # SQLite schema (users, threads, messages)
├── routes/
│   ├── auth.js           # register / login / me / pairing
│   └── messages.js       # paginated message history
├── middleware/
│   └── auth.js            # JWT verification for REST routes
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .env.example
└── package.json
```

## Notes on privacy & scope

- Messages are stored in plaintext in the SQLite database on your server, and only ever served to the two accounts in a thread — there's no admin panel or way for a third account to read them through the app.
- This is a solid starting point, not a hardened production system. Before putting real conversations through it on the open internet, you'd want at minimum: HTTPS in front of it, rate limiting on auth routes, and (if you want protection even from someone with server/database access) end-to-end encryption of message bodies.
- The whole thing runs as a single Node process with a local SQLite file — easy to self-host on a small VPS, Fly.io, Render, or similar.
