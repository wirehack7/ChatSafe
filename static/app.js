'use strict';

/* ============================================================
   ChatSafe – Client Application (Vanilla JS, Web Crypto API)
   ============================================================ */

// ---- Theme -------------------------------------------------------
function getTheme() {
  var stored = localStorage.getItem('cs-theme');
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('cs-theme', t);
}
function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);
document.getElementById('headerThemeToggle').addEventListener('click', toggleTheme);

// ---- Sidebar (mobile) --------------------------------------------
var sidebar        = document.getElementById('sidebar');
var sidebarOverlay = document.getElementById('sidebarOverlay');

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('visible');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
}

document.getElementById('hamburgerBtn').addEventListener('click', openSidebar);
document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// ---- Toast -------------------------------------------------------
var toastContainer = document.getElementById('toastContainer');

function showToast(msg) {
  var t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(function () { t.remove(); }, 3100);
}

// ---- Confirm Modal -----------------------------------------------
var confirmModal   = document.getElementById('confirmModal');
var confirmTitle   = document.getElementById('confirmTitle');
var confirmMessage = document.getElementById('confirmMessage');
var confirmYes     = document.getElementById('confirmYes');
var confirmNo      = document.getElementById('confirmNo');

function confirm(title, message) {
  return new Promise(function (resolve) {
    confirmTitle.textContent   = title;
    confirmMessage.textContent = message;
    confirmModal.classList.add('visible');

    function cleanup(val) {
      confirmModal.classList.remove('visible');
      confirmYes.removeEventListener('click', onYes);
      confirmNo.removeEventListener('click', onNo);
      resolve(val);
    }
    function onYes() { cleanup(true); }
    function onNo()  { cleanup(false); }

    confirmYes.addEventListener('click', onYes);
    confirmNo.addEventListener('click', onNo);
  });
}

// ---- AES-256-GCM Encryption (Web Crypto API) --------------------
async function deriveKey(keyString) {
  // Hash the URL key string with SHA-256 → use as raw AES-GCM key
  var raw = new TextEncoder().encode(keyString);
  var hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptMsg(text, cryptoKey) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    new TextEncoder().encode(text)
  );
  var combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);
  return 'v2:' + btoa(String.fromCharCode.apply(null, combined));
}

async function decryptMsg(payload, cryptoKey) {
  if (typeof payload !== 'string') return '[Ungültige Nachricht]';
  if (!payload.startsWith('v2:')) return payload; // plain text (system msgs)
  try {
    var combined = Uint8Array.from(atob(payload.slice(3)), function (c) { return c.charCodeAt(0); });
    var iv         = combined.slice(0, 12);
    var ciphertext = combined.slice(12);
    var decrypted  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return '[Entschlüsselung fehlgeschlagen]';
  }
}

// ---- DOM Helpers -------------------------------------------------
var messagesArea   = document.getElementById('messagesArea');
var inviteBanner   = document.getElementById('inviteBanner');
var inviteUrl      = document.getElementById('inviteUrl');
var headerName     = document.getElementById('headerRoomName');
var sidebarName    = document.getElementById('sidebarRoomName');
var headerCount    = document.getElementById('headerUserCount');
var lockBadge      = document.getElementById('lockBadge');
var userList       = document.getElementById('userList');
var lockBtn        = document.getElementById('lockBtn');
var lockLabel      = document.getElementById('lockLabel');
var lockIcon       = document.getElementById('lockIcon');
var clearBtn       = document.getElementById('clearBtn');
var leaveBtn       = document.getElementById('leaveBtn');
var inputArea      = document.getElementById('inputArea');
var messageInput   = document.getElementById('messageInput');
var sendBtn        = document.getElementById('sendBtn');
var joinPrompt     = document.getElementById('joinPrompt');
var joinBtn        = document.getElementById('joinBtn');
var joinModal      = document.getElementById('joinModal');
var usernameInput  = document.getElementById('usernameInput');
var joinConfirmBtn = document.getElementById('joinConfirmBtn');
var joinError      = document.getElementById('joinError');

function setRoomName(name) {
  document.title = name + ' · ChatSafe';
  headerName.textContent  = name;
  sidebarName.textContent = name;
}

function setUserCount(n) {
  headerCount.textContent = n + ' Teilnehmer' + (n === 1 ? '' : '');
}

function setLocked(locked) {
  if (locked) {
    lockBadge.classList.add('visible');
    lockLabel.textContent = 'Chat entsperren';
    lockBtn.className = 'btn btn-success';
  } else {
    lockBadge.classList.remove('visible');
    lockLabel.textContent = 'Chat sperren';
    lockBtn.className = 'btn btn-ghost';
  }
}

function renderUsers(chatters, myName) {
  userList.innerHTML = '';
  chatters.forEach(function (c) {
    var item = document.createElement('div');
    item.className = 'user-item' + (c.name === myName ? ' is-me' : '');
    item.innerHTML =
      '<div class="user-avatar ua-' + (c.colorId % 6) + '">' +
        escapeHtml(c.name.charAt(0).toUpperCase()) +
      '</div>' +
      '<span class="user-name">' + escapeHtml(c.name) + '</span>' +
      (c.name === myName ? '<span class="user-me-badge">Du</span>' : '');
    userList.appendChild(item);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  var d = new Date(ts);
  var h = d.getHours().toString().padStart(2, '0');
  var m = d.getMinutes().toString().padStart(2, '0');
  return h + ':' + m;
}

function appendMessage(msg, myName) {
  var isSystem  = !msg.sender;
  var isOutgoing = msg.sender === myName;

  var row = document.createElement('div');
  row.className = 'message-row ' + (isSystem ? 'system' : (isOutgoing ? 'outgoing' : 'incoming'));

  if (!isSystem && !isOutgoing) {
    var sender = document.createElement('div');
    sender.className = 'message-sender uc-' + ((msg.colorId || 0) % 6);
    sender.textContent = msg.sender;
    row.appendChild(sender);
  }

  var bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = msg.text;
  row.appendChild(bubble);

  if (!isSystem) {
    var timeEl = document.createElement('div');
    timeEl.className = 'message-time';
    timeEl.textContent = formatTime(msg.time);
    row.appendChild(timeEl);
  }

  messagesArea.appendChild(row);
}

function scrollToBottom() {
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

function showChatUI(joined) {
  if (joined) {
    joinPrompt.style.display  = 'none';
    messageInput.style.display = '';
    sendBtn.style.display      = '';
    sendBtn.disabled           = false;
    messageInput.focus();
  } else {
    joinPrompt.style.display   = '';
    messageInput.style.display = 'none';
    sendBtn.style.display      = 'none';
  }
}

function showJoinModal() {
  joinModal.classList.add('visible');
  setTimeout(function () { usernameInput.focus(); }, 100);
}

function hideJoinModal() {
  joinModal.classList.remove('visible');
  joinError.classList.remove('visible');
}

function showJoinError(msg) {
  joinError.textContent = msg;
  joinError.classList.add('visible');
}

// ---- Auto-resize textarea ----------------------------------------
messageInput.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 130) + 'px';
});

// ---- Main Init ---------------------------------------------------
(async function init() {
  var chatId    = location.pathname.slice(1);
  var keyString = location.hash.slice(1);

  if (!chatId || !keyString) {
    window.location.href = '/';
    return;
  }

  // Derive encryption key
  var cryptoKey;
  try {
    cryptoKey = await deriveKey(keyString);
  } catch (e) {
    showToast('Fehler beim Initialisieren der Verschlüsselung.');
    return;
  }

  // Show invite URL
  inviteUrl.value = location.href;
  inviteBanner.style.display = '';

  // Click to copy invite URL
  inviteUrl.addEventListener('click', function () {
    inviteUrl.select();
    try {
      navigator.clipboard.writeText(inviteUrl.value).then(function () {
        showToast('Link kopiert!');
      });
    } catch (e) { /* fallback: user copies manually */ }
  });

  var myName     = null;
  var chatters   = [];   // { name, colorId }
  var isLocked   = false;

  // ---- Socket.io ------------------------------------------------
  var socket = io({ reconnectionAttempts: 5 });

  socket.on('connect', function () {
    socket.emit('check_locked', { chatId: chatId });
  });

  socket.on('connect_error', function () {
    showToast('Verbindungsfehler. Verbinde erneut …');
  });

  socket.on('locked_status', function (data) {
    isLocked = data.locked;
    setLocked(isLocked);
    if (!myName) {
      if (isLocked) {
        showToast('Dieser Chat ist gesperrt.');
        showChatUI(false);
        joinPrompt.style.display = 'none';
      } else {
        showChatUI(false);
        showJoinModal();
      }
    }
  });

  socket.on('history', async function (data) {
    setRoomName(data.chatName);
    chatters = data.chatters || [];
    renderUsers(chatters, myName);
    setUserCount(chatters.length);

    // Decrypt and render history
    for (var i = 0; i < data.messages.length; i++) {
      var msg = data.messages[i];
      var copy = Object.assign({}, msg);
      if (copy.sender) {
        copy.text = await decryptMsg(copy.text, cryptoKey);
      }
      appendMessage(copy, myName);
    }
    scrollToBottom();
  });

  socket.on('join_response', function (data) {
    joinConfirmBtn.disabled = false;
    joinConfirmBtn.textContent = 'Beitreten';
    if (data.accepted) {
      myName = usernameInput.value.trim();
      chatters.push(data.chatter);
      renderUsers(chatters, myName);
      setUserCount(chatters.length);
      hideJoinModal();
      showChatUI(true);
      inviteBanner.style.display = '';
    } else {
      showJoinError(data.error || 'Beitritt abgelehnt.');
    }
  });

  socket.on('new_message', async function (msg) {
    var copy = Object.assign({}, msg);
    if (copy.sender) {
      copy.text = await decryptMsg(copy.text, cryptoKey);
    }
    appendMessage(copy, myName);
    scrollToBottom();
  });

  socket.on('user_joined', function (chatter) {
    if (!chatters.find(function (c) { return c.name === chatter.name; })) {
      chatters.push(chatter);
      renderUsers(chatters, myName);
      setUserCount(chatters.length);
    }
  });

  socket.on('user_left', function (data) {
    chatters = chatters.filter(function (c) { return c.name !== data.name; });
    renderUsers(chatters, myName);
    setUserCount(chatters.length);
  });

  socket.on('messages_cleared', function () {
    // Remove all message rows (keep invite banner)
    var rows = messagesArea.querySelectorAll('.message-row');
    rows.forEach(function (r) { r.remove(); });
    showToast('Nachrichten gelöscht.');
  });

  socket.on('locked_status', function (data) {
    isLocked = data.locked;
    setLocked(isLocked);
  });

  socket.on('error_msg', function (msg) {
    showToast(msg);
  });

  // ---- Join flow ------------------------------------------------
  function attemptJoin() {
    var name = usernameInput.value.trim();
    if (!name) { showJoinError('Bitte gib einen Benutzernamen ein.'); return; }
    joinConfirmBtn.disabled = true;
    joinConfirmBtn.innerHTML = '<span class="spinner"></span>';
    joinError.classList.remove('visible');
    socket.emit('join_chat', { chatId: chatId, username: name });
  }

  joinConfirmBtn.addEventListener('click', attemptJoin);
  usernameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); attemptJoin(); }
  });
  joinBtn.addEventListener('click', showJoinModal);

  // ---- Send message --------------------------------------------
  async function sendMessage() {
    var text = messageInput.value.trim();
    if (!text || !myName) return;

    var encrypted;
    try {
      encrypted = await encryptMsg(text, cryptoKey);
    } catch (e) {
      showToast('Verschlüsselungsfehler.');
      return;
    }

    // Optimistic: show own message immediately
    appendMessage({ text: text, sender: myName, colorId: 0, time: Date.now() }, myName);
    scrollToBottom();

    messageInput.value = '';
    messageInput.style.height = 'auto';
    socket.emit('send_message', { text: encrypted });
  }

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ---- Lock / Unlock ------------------------------------------
  lockBtn.addEventListener('click', async function () {
    if (isLocked) {
      var ok = await confirm(
        'Chat entsperren?',
        'Möchtest du alle Nachrichten vor dem Entsperren löschen?'
      );
      if (ok) socket.emit('clear_messages');
      socket.emit('unlock_chat');
    } else {
      socket.emit('lock_chat');
    }
  });

  // ---- Clear messages -----------------------------------------
  clearBtn.addEventListener('click', async function () {
    var ok = await confirm(
      'Nachrichten löschen?',
      'Alle Nachrichten werden unwiderruflich aus dem Chatverlauf entfernt.'
    );
    if (ok) socket.emit('clear_messages');
  });

  // ---- Leave --------------------------------------------------
  leaveBtn.addEventListener('click', async function () {
    var ok = await confirm(
      'Chat verlassen?',
      'Bist du sicher, dass du den Chat verlassen möchtest?'
    );
    if (ok) {
      socket.emit('leave_chat');
      window.location.href = '/';
    }
  });

})();
