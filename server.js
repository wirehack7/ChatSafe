'use strict';

const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e5, // 100 KB max payload
});

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Rate limiting
const createChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chats created. Please try again later.' },
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// Serve static files
app.use(
  express.static(path.join(__dirname, 'static'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  })
);

// In-memory chat store: Map<chatId, ChatRoom>
const chats = new Map();

function sanitize(value, maxLen = 100) {
  if (typeof value !== 'string') return '';
  return value.replace(/[<>"'`]/g, '').trim().slice(0, maxLen);
}

function toChatId(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: chats.size });
});

// Create a new chat room
app.get('/new/:chatName', createChatLimiter, (req, res) => {
  const rawName = sanitize(req.params.chatName, 50);
  const chatId = toChatId(rawName);
  const chatName = rawName.split('_').join(' ') || 'Chat';

  if (!chatId) {
    return res.status(400).json({ error: 'Invalid chat name.' });
  }
  if (chats.has(chatId)) {
    return res.status(409).json({ error: 'That name is already in use.' });
  }

  chats.set(chatId, {
    name: chatName,
    locked: false,
    messages: [],
    chatters: new Map(),
    createdAt: Date.now(),
  });

  res.json({ redirect: chatId });
});

// Serve chat page for existing rooms
app.get('/:chatId', (req, res) => {
  const chatId = sanitize(req.params.chatId, 50);
  if (chats.has(chatId)) {
    res.sendFile(path.join(__dirname, 'static', 'chat.html'));
  } else {
    res.redirect('/');
  }
});

// Socket.io
io.on('connection', (socket) => {
  let currentChat = null;
  let currentChatter = null;
  let msgCount = 0;
  let msgResetTimer = null;

  function cleanup() {
    if (msgResetTimer) clearTimeout(msgResetTimer);
  }

  socket.on('check_locked', ({ chatId }) => {
    const chat = chats.get(sanitize(chatId, 50));
    if (!chat) {
      socket.emit('error_msg', 'Chat room not found.');
      return;
    }
    socket.emit('locked_status', { locked: chat.locked });
  });

  socket.on('join_chat', ({ chatId, username }) => {
    const safeId = sanitize(chatId, 50);
    const safeName = sanitize(username, 30);
    const chat = chats.get(safeId);

    if (!chat) {
      socket.emit('join_response', { accepted: false, error: 'Chat room not found.' });
      return;
    }
    if (!safeName) {
      socket.emit('join_response', { accepted: false, error: 'Username is required.' });
      return;
    }
    if (chat.locked) {
      socket.emit('join_response', { accepted: false, error: 'This chat is locked.' });
      return;
    }
    if (chat.chatters.has(safeName)) {
      socket.emit('join_response', { accepted: false, error: `"${safeName}" is already taken.` });
      return;
    }

    const chatter = { name: safeName, colorId: crypto.randomInt(0, 6) };
    currentChat = chat;
    currentChatter = chatter;
    socket.data.chatId = safeId;

    chat.chatters.set(safeName, chatter);
    socket.join(safeId);

    // Send history
    socket.emit('history', {
      chatName: chat.name,
      messages: chat.messages.slice(-200),
      chatters: [...chat.chatters.values()],
    });

    socket.emit('join_response', { accepted: true, chatter });

    // Notify others
    socket.to(safeId).emit('user_joined', chatter);

    const sysMsg = { text: `${safeName} joined the chat`, sender: null, time: Date.now() };
    chat.messages.push(sysMsg);
    io.to(safeId).emit('new_message', sysMsg);
  });

  socket.on('send_message', ({ text }) => {
    if (!currentChat || !currentChatter) return;

    // Per-socket rate limit: 30 messages/minute
    msgCount++;
    if (!msgResetTimer) {
      msgResetTimer = setTimeout(() => {
        msgCount = 0;
        msgResetTimer = null;
      }, 60000);
    }
    if (msgCount > 30) {
      socket.emit('error_msg', 'Slow down — too many messages.');
      return;
    }

    if (typeof text !== 'string' || text.length === 0 || text.length > 10000) {
      socket.emit('error_msg', 'Invalid message.');
      return;
    }

    const msg = {
      text,
      sender: currentChatter.name,
      colorId: currentChatter.colorId,
      time: Date.now(),
    };

    currentChat.messages.push(msg);
    if (currentChat.messages.length > 500) currentChat.messages.shift();
    io.to(socket.data.chatId).emit('new_message', msg);
  });

  socket.on('clear_messages', () => {
    if (!currentChat || !currentChatter) return;
    currentChat.messages = [];
    io.to(socket.data.chatId).emit('messages_cleared');
  });

  socket.on('lock_chat', () => {
    if (!currentChat || !currentChatter) return;
    currentChat.locked = true;
    io.to(socket.data.chatId).emit('locked_status', { locked: true });
    const sysMsg = { text: `${currentChatter.name} locked the chat`, sender: null, time: Date.now() };
    currentChat.messages.push(sysMsg);
    io.to(socket.data.chatId).emit('new_message', sysMsg);
  });

  socket.on('unlock_chat', () => {
    if (!currentChat || !currentChatter) return;
    currentChat.locked = false;
    io.to(socket.data.chatId).emit('locked_status', { locked: false });
    const sysMsg = { text: `${currentChatter.name} unlocked the chat`, sender: null, time: Date.now() };
    currentChat.messages.push(sysMsg);
    io.to(socket.data.chatId).emit('new_message', sysMsg);
  });

  function handleLeave() {
    if (!currentChat || !currentChatter) return;
    const chatId = socket.data.chatId;
    const name = currentChatter.name;
    currentChat.chatters.delete(name);
    socket.to(chatId).emit('user_left', { name });
    const sysMsg = { text: `${name} left the chat`, sender: null, time: Date.now() };
    currentChat.messages.push(sysMsg);
    io.to(chatId).emit('new_message', sysMsg);
    if (currentChat.chatters.size === 0) chats.delete(chatId);
    cleanup();
    currentChat = null;
    currentChatter = null;
  }

  socket.on('leave_chat', handleLeave);
  socket.on('disconnect', handleLeave);
});

// Cleanup abandoned rooms every hour
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, chat] of chats.entries()) {
    if (chat.chatters.size === 0 && chat.createdAt < cutoff) {
      chats.delete(id);
    }
  }
}, 60 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`ChatSafe listening on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
