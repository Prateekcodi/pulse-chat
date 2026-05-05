"use strict";
/* ═══════════════════════════════════════════════════════════════
   PULSE CHAT — Client v3.0  "Liquid Carbon"
   Aurora canvas · Avatar system · Animated messages
═══════════════════════════════════════════════════════════════ */

/* ── Aurora Canvas ──────────────────────────────────────────────── */
(function initAurora() {
  const canvas = document.getElementById("aurora");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, blobs;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function mkBlob() {
    const hues = [168, 250, 30, 200, 280];
    const h = hues[Math.random() * hues.length | 0];
    return {
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  200 + Math.random() * 280,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.18,
      h,
      s:  60 + Math.random() * 30,
      l:  40 + Math.random() * 20,
      a:  0.06 + Math.random() * 0.1,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0008 + Math.random() * 0.0014,
    };
  }

  function init() {
    resize();
    blobs = Array.from({ length: 7 }, mkBlob);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    blobs.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -b.r) b.x = W + b.r;
      if (b.x > W + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = H + b.r;
      if (b.y > H + b.r) b.y = -b.r;

      const alpha = b.a * (0.7 + 0.3 * Math.sin(t * b.speed + b.phase));
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      grad.addColorStop(0,   `hsla(${b.h},${b.s}%,${b.l}%,${alpha})`);
      grad.addColorStop(0.5, `hsla(${b.h},${b.s}%,${b.l}%,${alpha * 0.4})`);
      grad.addColorStop(1,   `hsla(${b.h},${b.s}%,${b.l}%,0)`);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  init();
  requestAnimationFrame(draw);
})();

/* ── State ──────────────────────────────────────────────────────── */
let myUsername   = null;
let myDeviceId   = localStorage.getItem("deviceId");
if (!myDeviceId) {
  myDeviceId = crypto.randomUUID();
  localStorage.setItem("deviceId", myDeviceId);
}

/* ── DOM ────────────────────────────────────────────────────────── */
const loginOverlay    = document.getElementById("login-overlay");
const usernameInput   = document.getElementById("username-input");
const joinBtn         = document.getElementById("join-btn");
const app             = document.getElementById("app");
const userList        = document.getElementById("user-list");
const userCountEl     = document.getElementById("user-count");
const messagesEl      = document.getElementById("messages");
const messagesWrap    = document.getElementById("messages-container");
const messageInput    = document.getElementById("message-input");
const sendBtn         = document.getElementById("send-btn");
const imageInput      = document.getElementById("image-input");
const imageBtn        = document.getElementById("image-btn");
const myAvatarEl      = document.getElementById("my-avatar");
const myNameEl        = document.getElementById("my-name");

/* ── Socket ─────────────────────────────────────────────────────── */
const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
socket.on("connect_error", () => appendSystemMsg("Connection lost — retrying…"));
socket.on("disconnect",    () => appendSystemMsg("Disconnected"));
socket.on("connect",       () => { if (myUsername) socket.emit("user:join", { deviceId: myDeviceId, username: myUsername }); });

/* ── Colour & Avatar helpers ────────────────────────────────────── */
const PALETTE = ["#00e5b0","#ff7b45","#7c6af7","#f0c040","#4cb8f5","#e05c8a","#a0e040","#c47cf7"];

function colorFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(name) {
  return String(name).slice(0, 2).toUpperCase();
}

function makeAvatar(name, size = 36) {
  const div = document.createElement("div");
  div.className = "msg-avatar";
  div.textContent = initials(name);
  const color = colorFor(name);
  div.style.cssText = `width:${size}px;height:${size}px;background:${color};`;
  return div;
}

/* ── Time ───────────────────────────────────────────────────────── */
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── XSS guard ──────────────────────────────────────────────────── */
function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

/* ── Auto-scroll ────────────────────────────────────────────────── */
function scrollBottom(instant = false) {
  if (instant) {
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  } else {
    messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: "smooth" });
  }
}

/* ── System message ─────────────────────────────────────────────── */
function appendSystemMsg(text) {
  const d = document.createElement("div");
  d.className = "msg-system";
  d.textContent = text;
  messagesEl.appendChild(d);
  scrollBottom();
}

/* ── Render a chat message ──────────────────────────────────────── */
function renderMessage(msg) {
  if (!msg) return;

  const text      = msg.text || "";
  const imageUrl  = msg.imageUrl || "";
  const sender    = msg.senderName || msg.username || "Unknown";
  const ts        = msg.timestamp || Date.now();
  const color     = colorFor(sender);
  const isMine    = msg.senderDeviceId === myDeviceId;
  const msgTime   = new Date(ts);
  const now       = new Date();
  const canDelete = isMine && (now - msgTime) < 3600000;

  const wrap = document.createElement("div");
  wrap.className = "msg";
  wrap.dataset.id = msg._id;
  if (msg.senderDeviceId) wrap.dataset.deviceId = msg.senderDeviceId;

  const av = makeAvatar(sender);
  wrap.appendChild(av);

  const body = document.createElement("div");
  body.className = "msg-body";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `
    <span class="msg-username" style="color:${color}">${esc(sender)}</span>
    <span class="msg-time">${fmtTime(ts)}${msg.edited ? ' <span class="msg-edited">(edited)</span>' : ''}</span>
  `;
  body.appendChild(meta);

  if (text) {
    const p = document.createElement("div");
    p.className = "msg-text";
    p.textContent = text;
    p.contentEditable = isMine ? "true" : "false";
    p.onblur = () => {
      if (p.textContent !== text) {
        socket.emit("message:edit", { messageId: msg._id, text: p.textContent });
      }
    };
    p.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        p.blur();
      }
    };
    body.appendChild(p);
  }

  if (imageUrl) {
    const img = document.createElement("img");
    img.className = "msg-image";
    img.src = imageUrl;
    img.alt = "Shared image";
    img.loading = "lazy";
    img.style.cursor = "pointer";
    img.dataset.viewed = "false";
    
    const overlay = document.createElement("div");
    overlay.className = "image-overlay";
    overlay.innerHTML = "🔒 Tap to view (protected)";
    
    const imgContainer = document.createElement("div");
    imgContainer.style.position = "relative";
    imgContainer.appendChild(img);
    imgContainer.appendChild(overlay);
    
    img.onclick = () => {
      if (img.dataset.viewed === "false") {
        img.dataset.viewed = "true";
        overlay.style.display = "none";
        img.style.filter = "none";
        socket.emit("image:seen", msg._id);
      } else {
        window.open(imageUrl, "_blank");
      }
    };
    
    body.appendChild(imgContainer);
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML = `
    <button class="reaction-btn" onclick="addReaction('${msg._id}', '👍')">👍</button>
    <button class="reaction-btn" onclick="addReaction('${msg._id}', '❤️')">❤️</button>
    <button class="reaction-btn" onclick="addReaction('${msg._id}', '😂')">😂</button>
    ${isMine ? `<button class="delete-btn" onclick="deleteMessage('${msg._id}')">🗑️</button>` : ''}
    ${canDelete ? `<button class="delete-btn" title="Delete within 1 hour" onclick="deleteMessage('${msg._id}')">🗑️</button>` : ''}
  `;
  body.appendChild(actions);

  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  scrollBottom();
}

/* ── Join chat ──────────────────────────────────────────────────── */
function joinChat() {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.style.borderColor = "rgba(255,100,100,0.5)";
    usernameInput.style.boxShadow   = "0 0 0 3px rgba(255,100,100,0.1)";
    setTimeout(() => {
      usernameInput.style.borderColor = "";
      usernameInput.style.boxShadow   = "";
    }, 900);
    usernameInput.focus();
    return;
  }

  myUsername = name;

  if (myAvatarEl) {
    myAvatarEl.textContent = initials(name);
    myAvatarEl.style.background = colorFor(name);
  }
  if (myNameEl) myNameEl.textContent = name;

  loginOverlay.classList.add("out");
  setTimeout(() => {
    loginOverlay.style.display = "none";
    app.classList.remove("hidden");
    messageInput.focus();
  }, 500);

  socket.emit("user:join", { deviceId: myDeviceId, username: name });
}

joinBtn.addEventListener("click", joinChat);
usernameInput.addEventListener("keydown", e => { if (e.key === "Enter") joinChat(); });
window.addEventListener("load", () => usernameInput.focus());

/* ── Send message ───────────────────────────────────────────────── */
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !myUsername) return;

  sendBtn.style.transform = "scale(0.88)";
  setTimeout(() => { sendBtn.style.transform = ""; }, 140);

  socket.emit("message:send", { text });
  messageInput.value = "";
  messageInput.focus();
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });

/* ── Image send ─────────────────────────────────────────────────── */
imageBtn.addEventListener("click", () => imageInput.click());

imageInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file || !myUsername) return;
  imageBtn.disabled = true;
  imageBtn.style.opacity = "0.4";
  const reader = new FileReader();
  reader.onload = ev => {
    socket.emit("image:send", { imageUrl: ev.target.result });
    imageBtn.disabled = false;
    imageBtn.style.opacity = "";
    imageInput.value = "";
  };
  reader.readAsDataURL(file);
});

/* ── Socket events ──────────────────────────────────────────────── */
socket.on("messages:history", msgs => {
  msgs.forEach((m, i) => {
    setTimeout(() => renderMessage(m), i * 18);
  });
  setTimeout(() => scrollBottom(true), msgs.length * 18 + 60);
});

socket.on("message:new", msg => renderMessage(msg));

socket.on("message:edited", msg => {
  const el = document.querySelector(`[data-id="${msg._id}"] .msg-text`);
  if (el) {
    el.textContent = msg.text;
  }
});

socket.on("message:deleted", msgId => {
  const el = document.querySelector(`[data-id="${msgId}"]`);
  if (el) el.remove();
});

socket.on("server:message", data => {
  if (data && data.type === "system") {
    appendSystemMsg(data.text);
  } else if (data) {
    renderMessage(data);
  }
});

socket.on("users:update", users => {
  if (!userCountEl || !userList) return;
  userCountEl.textContent = users.length;
  userList.innerHTML = "";

  users.forEach((u, i) => {
    const name = typeof u === "string" ? u : (u.username || "");
    const li = document.createElement("li");
    li.style.animationDelay = `${i * 45}ms`;

    const av = document.createElement("div");
    av.className = "ul-avatar";
    av.textContent = initials(name);
    av.style.background = colorFor(name);

    const span = document.createElement("span");
    span.className = "ul-name";
    span.textContent = name;

    li.appendChild(av);
    li.appendChild(span);
    userList.appendChild(li);
  });
});

socket.on("server:users", users => {
  if (!userCountEl || !userList) return;
  userCountEl.textContent = users.length;
  userList.innerHTML = "";

  users.forEach((name, i) => {
    const li = document.createElement("li");
    li.style.animationDelay = `${i * 45}ms`;

    const av = document.createElement("div");
    av.className = "ul-avatar";
    av.textContent = initials(name);
    av.style.background = colorFor(name);

    const span = document.createElement("span");
    span.className = "ul-name";
    span.textContent = name;

    li.appendChild(av);
    li.appendChild(span);
    userList.appendChild(li);
  });
});

/* ── Edit message ───────────────────────────────────────────────── */
function editMessage(msgId) {
  const textEl = document.querySelector(`[data-id="${msgId}"] .msg-text`);
  if (!textEl) return;
  const newText = prompt("Edit message:", textEl.textContent);
  if (newText !== null) {
    socket.emit("message:edit", { messageId: msgId, text: newText });
  }
}

/* ── Reactions ─────────────────────────────────────────────────────── */
function addReaction(msgId, emoji) {
  socket.emit("reaction:add", { messageId: msgId, emoji });
}

/* ── Delete message ────────────────────────────────────────────────── */
function deleteMessage(msgId) {
  if (confirm("Delete this message?")) {
    socket.emit("message:delete", { messageId: msgId });
  }
}

/* ── PWA ────────────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

let deferredPrompt;
const isFirstVisit = !localStorage.getItem("pwaDismissed");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (isFirstVisit) {
    setTimeout(showInstallBanner, 3000);
  }
});

function showInstallBanner() {
  if (document.getElementById("pwa-banner")) return;
  const banner = document.createElement("div");
  banner.id = "pwa-banner";
  banner.innerHTML = `
    <div class="pwa-content">
      <span>📱 Install Chat App for better experience</span>
      <button id="pwa-install">Install</button>
      <button id="pwa-dismiss">✕</button>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById("pwa-install").onclick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      localStorage.setItem("pwaDismissed", "true");
      banner.remove();
    }
  };
  document.getElementById("pwa-dismiss").onclick = () => {
    localStorage.setItem("pwaDismissed", "true");
    banner.remove();
  };
}