(() => {
  const state = {
    token: localStorage.getItem('twine_token') || null,
    user: null,
    partner: null,
    socket: null,
    oldestMessageId: null,
    typingTimeout: null,
  };

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const views = {
    auth: $('#view-auth'),
    pair: $('#view-pair'),
    chat: $('#view-chat'),
  };

  function showView(name) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[name].classList.add('active');
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function setToken(token) {
    state.token = token;
    if (token) localStorage.setItem('twine_token', token);
    else localStorage.removeItem('twine_token');
  }

  function logout() {
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    setToken(null);
    state.user = null;
    state.partner = null;
    showView('auth');
  }

  // ---------- boot ----------
  async function boot() {
    if (!state.token) return showView('auth');
    try {
      const { user, partner } = await api('/auth/me');
      state.user = user;
      state.partner = partner;
      if (partner) {
        enterChat();
      } else {
        enterPairing();
      }
    } catch {
      logout();
    }
  }

  // ---------- auth: tabs ----------
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      $(`#form-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // ---------- auth: login ----------
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#login-error');
    errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      const { token, user } = await api('/auth/login', {
        method: 'POST',
        body: { email: fd.get('email'), password: fd.get('password') },
      });
      setToken(token);
      state.user = user;
      await boot();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // ---------- auth: register ----------
  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#register-error');
    errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      const { token, user } = await api('/auth/register', {
        method: 'POST',
        body: {
          displayName: fd.get('displayName'),
          email: fd.get('email'),
          password: fd.get('password'),
        },
      });
      setToken(token);
      state.user = user;
      enterPairing();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // ---------- pairing ----------
  function enterPairing() {
    $('#my-code').textContent = state.user.inviteCode;
    showView('pair');
  }

  $('#copy-code').addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.user.inviteCode).catch(() => {});
    const btn = $('#copy-code');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = original), 1500);
  });

  $('#form-redeem').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#pair-error');
    errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      const { partner } = await api('/auth/pair/redeem', {
        method: 'POST',
        body: { code: fd.get('code') },
      });
      state.partner = partner;
      enterChat();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  $('#logout-from-pair').addEventListener('click', logout);

  // ---------- chat ----------
  function enterChat() {
    showView('chat');
    $('#partner-name').textContent = state.partner.displayName;
    $('#messages').querySelectorAll('.msg-row, .msg-time, .day-divider').forEach(n => n.remove());
    state.oldestMessageId = null;
    loadHistory();
    connectSocket();
  }

  async function loadHistory(before) {
    const q = before ? `?before=${before}` : '';
    const { messages } = await api(`/messages${q}`);
    const container = $('#messages');
    const loadMoreBtn = $('#load-more');

    if (messages.length > 0) {
      state.oldestMessageId = messages[0].id;
      loadMoreBtn.hidden = messages.length < 50;
    } else if (!before) {
      loadMoreBtn.hidden = true;
    }

    const frag = document.createDocumentFragment();
    messages.forEach(m => frag.appendChild(renderMessage(m)));

    if (before) {
      const scrollHeightBefore = container.scrollHeight;
      loadMoreBtn.after(frag);
      container.scrollTop = container.scrollHeight - scrollHeightBefore;
    } else {
      container.appendChild(frag);
      container.scrollTop = container.scrollHeight;
    }
  }

  $('#load-more').addEventListener('click', () => {
    if (state.oldestMessageId) loadHistory(state.oldestMessageId);
  });

  function renderMessage(m) {
    const wrap = document.createDocumentFragment ? document.createElement('div') : null;
    const mine = m.senderId === state.user.id;
    const row = document.createElement('div');
    row.className = `msg-row ${mine ? 'mine' : 'theirs'}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.body;
    row.appendChild(bubble);

    const time = document.createElement('div');
    time.className = 'msg-time';
    time.style.textAlign = mine ? 'right' : 'left';
    time.textContent = formatTime(m.createdAt);

    const holder = document.createElement('div');
    holder.appendChild(row);
    holder.appendChild(time);
    return holder;
  }

  function formatTime(iso) {
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
  }

  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    state.socket = io({ auth: { token: state.token } });

    state.socket.on('message:new', (m) => {
      const container = $('#messages');
      container.appendChild(renderMessage(m));
      container.scrollTop = container.scrollHeight;
      if (m.senderId !== state.user.id) setTyping(false);
    });

    state.socket.on('presence', ({ online }) => setPresence(online));
    state.socket.on('presence:snapshot', ({ onlineUserIds }) => {
      setPresence(onlineUserIds.length > 0);
    });

    state.socket.on('typing', ({ isTyping }) => setTyping(isTyping));

    state.socket.on('connect_error', (err) => {
      if (err.message === 'not_paired') {
        enterPairing();
      }
    });
  }

  function setPresence(online) {
    const el = $('#partner-status');
    el.textContent = online ? 'online' : 'offline';
    el.classList.toggle('online', online);
  }

  function setTyping(isTyping) {
    const row = $('#typing-row');
    row.hidden = !isTyping;
    if (isTyping) $('#typing-label').textContent = `${state.partner?.displayName || 'They'} is typing`;
  }

  // ---------- composer ----------
  const input = $('#composer-input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    if (state.socket) {
      state.socket.emit('typing', true);
      clearTimeout(state.typingTimeout);
      state.typingTimeout = setTimeout(() => state.socket.emit('typing', false), 1200);
    }
  });

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !state.socket) return;
    const sendBtn = $('#send-btn');
    sendBtn.disabled = true;
    state.socket.emit('message:send', { body }, (res) => {
      sendBtn.disabled = false;
      if (res?.error) {
        alert(res.error);
      }
    });
    input.value = '';
    input.style.height = 'auto';
    state.socket.emit('typing', false);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });

  // ---------- options panel ----------
  $('#menu-btn').addEventListener('click', () => {
    $('#options-panel').classList.toggle('open');
  });

  $('#unlink-btn').addEventListener('click', async () => {
    if (!confirm('Unlink from your partner? You\u2019ll both need to reconnect with new codes to chat again.')) return;
    await api('/auth/pair/unlink', { method: 'POST' }).catch(() => {});
    state.partner = null;
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    const { user } = await api('/auth/me');
    state.user = user;
    $('#options-panel').classList.remove('open');
    enterPairing();
  });

  $('#logout-from-chat').addEventListener('click', logout);

  boot();
})();
