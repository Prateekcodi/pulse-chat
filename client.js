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
let myUsername   = localStorage.getItem("username") || null;
let myDeviceId   = localStorage.getItem("deviceId");
if (!myDeviceId) {
  myDeviceId = crypto.randomUUID();
  localStorage.setItem("deviceId", myDeviceId);
}

let currentChat = { type: "group", recipientId: null }; // group or dm
let friends = []; // Array of friend objects
let pendingRequests = [];

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
const myProfile       = document.getElementById("my-profile");

/* ── Socket ─────────────────────────────────────────────────────── */
const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
socket.on("connect_error", () => appendSystemMsg("Connection lost — retrying…"));
socket.on("disconnect",    () => appendSystemMsg("Disconnected"));
socket.on("connect", () => { 
   if (myUsername) {
     socket.emit("user:join", { deviceId: myDeviceId, username: myUsername });
     setTimeout(() => {
       loadFriends();
       socket.emit("user:list");
     }, 500);
   }
 });

// Profile click handler
if (myProfile) {
  myProfile.style.cursor = "pointer";
  myProfile.onclick = (e) => {
    showUserInfo(myUsername, null, true, e.clientX, e.clientY);
  };
  myProfile.addEventListener('touchend', (e) => {
    const touch = e.changedTouches[0];
    showUserInfo(myUsername, null, true, touch.clientX, touch.clientY);
  });
}

/* ── Colour & Avatar helpers ────────────────────────────────────── */
const PALETTE = ["#00e5b0","#ff7b45","#7c6af7","#f0c040","#4cb8f5","#e05c8a","#a0e040","#c47cf7"];

// GIF functionality
let gifModal = null;

function showGifPicker() {
  if (gifModal) {
    gifModal.classList.add("show");
    return;
  }
  
  const modal = document.createElement("div");
  modal.id = "gif-modal";
  modal.className = "gif-modal";
  modal.innerHTML = `
    <div class="gif-content">
      <div class="gif-header">
        <span>Adult GIFs</span>
        <button class="gif-close" onclick="closeGifPicker()">✕</button>
      </div>
      <div class="gif-grid" id="gif-grid">
        <div class="gif-loading">Loading GIFs...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  gifModal = modal;
  
  loadGifs();
}

function closeGifPicker() {
  if (gifModal) {
    gifModal.classList.remove("show");
  }
}

async function loadGifs() {
  const grid = document.getElementById("gif-grid");
  try {
    // Use bestadultgifs.com - fetch trending/adult gifs via RSS
    const response = await fetch("https://bestadultgifs.com/feed/");
    const text = await response.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    const items = xml.querySelectorAll("item");
    
    let html = "";
    items.forEach((item, i) => {
      if (i >= 18) return;
      const content = item.querySelector("content\\:encoded")?.textContent || item.querySelector("description")?.textContent || "";
      const imgMatch = content.match(/<img[^>]+src="([^">]+)"/);
      const imgUrl = imgMatch ? imgMatch[1] : null;
      if (imgUrl) {
        html += `<div class="gif-item" onclick="sendGif('${imgUrl}')">
          <img src="${imgUrl}" alt="GIF" loading="lazy">
        </div>`;
      }
    });
    
    if (html) {
      grid.innerHTML = html;
    } else {
      grid.innerHTML = '<div class="gif-loading">No GIFs available</div>';
    }
  } catch (err) {
    console.error("GIF load error:", err);
    grid.innerHTML = '<div class="gif-loading">Failed to load GIFs</div>';
  }
}

function sendGif(url) {
  if (myUsername && currentChat.type === "dm") {
    socket.emit("dm:send", { text: "", imageUrl: url, recipientId: currentChat.recipientId });
  } else if (myUsername) {
    socket.emit("message:send", { text: "", imageUrl: url });
  }
  closeGifPicker();
}

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

function formatLastSeenPrecise(ts) {
  if (!ts) return "never";
  const diff = Date.now() - new Date(ts);
  if (diff < 10000) return "online";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function showUserInfo(name, lastSeen, isOnline, clientX, clientY) {
  let tooltip = document.getElementById("user-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "user-tooltip";
    tooltip.className = "user-tooltip";
    document.body.appendChild(tooltip);
  }
  const timeStr = isOnline ? "online" : formatLastSeenPrecise(lastSeen);
  tooltip.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:32px;height:32px;border-radius:50%;background:${colorFor(name)};display:flex;align-items:center;justify-content:center;font-weight:700;color:#000;">${initials(name)}</div>
      <div>
        <div style="color:var(--mint);font-weight:600;margin-bottom:2px;">${name}</div>
        <div style="color:var(--tx-secondary);font-size:11px;">${timeStr}</div>
      </div>
    </div>
  `;
  const x = clientX || window.innerWidth / 2;
  const y = clientY || window.innerHeight / 2;
  tooltip.style.left = (x + 12) + "px";
  tooltip.style.top = (y - 30) + "px";
  tooltip.classList.add("show");
  setTimeout(() => tooltip.classList.remove("show"), 3000);
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

/* ── History Pagination ─────────────────────────────────────────────── */
let hasMoreMessages = true;
let isLoadingMessages = false;
let oldestMessageTime = null;

function prependMessages(msgs) {
  const fragment = document.createDocumentFragment();
  msgs.forEach((m, i) => {
    const wrap = createMessageElement(m);
    if (wrap) fragment.appendChild(wrap);
  });
  messagesEl.insertBefore(fragment, messagesEl.firstChild);
  if (msgs.length > 0) {
    oldestMessageTime = new Date(msgs[msgs.length - 1].timestamp);
  }
}

function createMessageElement(msg) {
  if (!msg) return null;
  const text      = msg.text || "";
  const imageUrl  = msg.imageUrl || "";
  const sender    = msg.senderName || msg.username || "Unknown";
  const ts        = msg.timestamp || Date.now();
  const color     = colorFor(sender);
  const isMine    = msg.senderDeviceId === myDeviceId;

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
    const p = document.createElement("p");
    p.className = "msg-text";
    p.textContent = text;
    body.appendChild(p);
  }

  if (imageUrl) {
    const img = document.createElement("img");
    img.className = "msg-image";
    img.src = imageUrl;
    img.dataset.viewOnce = msg.viewOnce || false;
    body.appendChild(img);
  }

  const status = document.createElement("span");
  status.className = "msg-status";
  const deliveredCount = (msg.deliveredTo || []).length;
  const seenCount = (msg.seenBy || []).length;
  if (seenCount > 0) {
    status.innerHTML = '<span style="color:#5ac8fa;">✓✓</span>';
  } else if (deliveredCount > 0) {
    status.innerHTML = '<span style="color:#888;">✓✓</span>';
  } else if (isMine) {
    status.innerHTML = '<span style="color:#666;">✓</span>';
  }
  meta.appendChild(status);

  wrap.appendChild(body);
  return wrap;
}

/* ── System message ─────────────────────────────────────────────── */
function appendSystemMsg(text) {
  const d = document.createElement("div");
  d.className = "msg-system";
  d.textContent = text;
  messagesEl.appendChild(d);
  scrollBottom();
}

/* ── Reply State ─────────────────────────────────────────────────── */
let replyTo = null;

function setReply(msgId, username, text) {
  replyTo = { id: msgId, username, text };
  const preview = document.getElementById("reply-preview");
  const replyUsername = document.getElementById("reply-username");
  const replyText = document.getElementById("reply-text");
  if (preview && replyUsername && replyText) {
    replyUsername.textContent = username;
    replyText.textContent = text.length > 60 ? text.slice(0, 60) + "…" : text;
    preview.classList.remove("hidden");
  }
}

function clearReply() {
  replyTo = null;
  const preview = document.getElementById("reply-preview");
  if (preview) preview.classList.add("hidden");
}

// Expose to global for onclick handlers
window.setReply = setReply;
window.clearReply = clearReply;

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
  av.style.cursor = "pointer";
  av.onclick = (e) => {
    showUserInfo(sender, null, true, e.clientX, e.clientY);
  };
  av.addEventListener('touchend', (e) => {
    const touch = e.changedTouches[0];
    showUserInfo(sender, null, true, touch.clientX, touch.clientY);
  });
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

  // Reply indicator (shown before message text)
  if (msg.replyTo) {
    const replyDiv = document.createElement("div");
    replyDiv.className = "msg-reply";
    replyDiv.innerHTML = `
      <span class="msg-reply-label">↳ ${esc(msg.replyTo.username)}</span>
      <span class="msg-reply-text">${esc(msg.replyTo.text.length > 60 ? msg.replyTo.text.slice(0, 60) + "…" : msg.replyTo.text)}</span>
    `;
    body.appendChild(replyDiv);
  }

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
    img.dataset.viewOnce = msg.viewOnce || false;
    
    const openImage = () => {
      if (img.dataset.viewOnce === "false") {
        window.open(imageUrl, "_blank");
        setTimeout(() => {
          socket.emit("image:seen", msg._id);
        }, 1000);
      } else {
        const modal = document.createElement("div");
        modal.id = "view-once-modal";
        modal.style.cssText = `
          position:fixed;top:0;left:0;width:100%;height:100%;
          background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;z-index:10000;
        `;
        const viewerImg = document.createElement("img");
        viewerImg.src = imageUrl;
        viewerImg.style.maxWidth = "90%";
        viewerImg.style.maxHeight = "90%";
        viewerImg.style.borderRadius = "8px";
        modal.appendChild(viewerImg);
        document.body.appendChild(modal);
        
        setTimeout(() => {
          if (document.getElementById("view-once-modal")) {
            document.getElementById("view-once-modal").remove();
            const el = document.querySelector(`[data-id="${msg._id}"] .msg-image`);
            if (el) {
              el.style.filter = "blur(8px)";
              el.style.pointerEvents = "none";
            }
          }
          socket.emit("image:seen", msg._id);
        }, 20000);
      }
    };
    
    img.onclick = openImage;
    body.appendChild(img);
  }

  const status = document.createElement("span");
  status.className = "msg-status";
  const deliveredCount = (msg.deliveredTo || []).length;
  const seenCount = (msg.seenBy || []).length;
  if (seenCount > 0) {
    status.innerHTML = '<span style="color:#5ac8fa;">✓✓</span>';
  } else if (deliveredCount > 0) {
    status.innerHTML = '<span style="color:#888;">✓✓</span>';
  } else if (isMine) {
    status.innerHTML = '<span style="color:#666;">✓</span>';
  }
  meta.appendChild(status);

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const msgId = msg._id;
  const safeUsername = sender.replace(/'/g, "\\'");
  const safeText = text.replace(/'/g, "\\'").replace(/\n/g, "\\n");
  actions.innerHTML = `
    ${canDelete ? `<button class="delete-btn" onclick="deleteMessage('${msg._id}')" title="Delete">🗑️</button>` : ''}
    <button class="reply-btn" onclick="setReply('${msgId}', '${safeUsername}', '${safeText}')" title="Reply">↳</button>
    <button class="reaction-btn" onclick="addReaction('${msg._id}', '👍')">👍</button>
    <button class="reaction-btn" onclick="addReaction('${msg._id}', '❤️')">❤️</button>
    <button class="reaction-btn" onclick="addReaction('${msg._id}', '😂')">😂</button>
  `;
  
  // Touch support for mobile - show actions on tap
  let hideTimer;
  wrap.addEventListener('touchstart', () => {
    actions.style.opacity = "1";
    if (hideTimer) clearTimeout(hideTimer);
  });
  wrap.addEventListener('touchend', () => {
    hideTimer = setTimeout(() => {
      actions.style.opacity = "";
    }, 3000);
  });
  
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
  localStorage.setItem("username", name);

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
    setTimeout(loadFriends, 500);
  }, 500);

  socket.emit("user:join", { deviceId: myDeviceId, username: name });
}

/* ── Logout ─────────────────────────────────────────────────────── */
function logout() {
  localStorage.removeItem("username");
  myUsername = null;
  app.classList.add("hidden");
  loginOverlay.style.display = "flex";
  loginOverlay.classList.remove("out");
  usernameInput.value = "";
  usernameInput.focus();
}

joinBtn.addEventListener("click", joinChat);
usernameInput.addEventListener("keydown", e => { if (e.key === "Enter") joinChat(); });
window.addEventListener("load", () => {
  if (myUsername) {
    myAvatarEl.textContent = initials(myUsername);
    myAvatarEl.style.background = colorFor(myUsername);
    myNameEl.textContent = myUsername;
    app.classList.remove("hidden");
    loginOverlay.style.display = "none";
    messageInput.focus();
  } else {
    usernameInput.focus();
  }
});

/* ── Send message ───────────────────────────────────────────────── */
sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });

/* ── Cancel reply ─────────────────────────────────────────────────── */
document.getElementById("cancel-reply").addEventListener("click", clearReply);

/* ── Image send ─────────────────────────────────────────────────── */
imageBtn.addEventListener("click", () => imageInput.click());

/* ── GIF send ─────────────────────────────────────────────────── */
const gifBtn = document.getElementById("gif-btn");
if (gifBtn) {
  gifBtn.addEventListener("click", showGifPicker);
}

/* Right-click for view-once image */
imageBtn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  getFileFromUser().then(file => {
    if (file && myUsername) {
      imageBtn.disabled = true;
      imageBtn.style.opacity = "0.4";
      const reader = new FileReader();
      reader.onload = ev => {
        const imageUrl = ev.target.result;
        const tempId = "img_" + Date.now();
        const tempMsg = {
          _id: tempId,
          senderDeviceId: myDeviceId,
          senderName: myUsername,
          username: myUsername,
          type: "image",
          imageUrl: imageUrl,
          timestamp: new Date(),
          viewOnce: true
        };
        renderMessage(tempMsg);
        socket.emit("image:send", { imageUrl, viewOnce: true });
        imageBtn.disabled = false;
        imageBtn.style.opacity = "";
        imageInput.value = "";
      };
      reader.readAsDataURL(file);
    }
  });
});

function getFileFromUser() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files[0]);
    input.click();
  });
}

imageInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file || !myUsername) return;
  imageBtn.disabled = true;
  imageBtn.style.opacity = "0.4";
  const reader = new FileReader();
  reader.onload = ev => {
    const imageUrl = ev.target.result;
    const tempId = "img_" + Date.now();
    const tempMsg = {
      _id: tempId,
      senderDeviceId: myDeviceId,
      senderName: myUsername,
      username: myUsername,
      type: "image",
      imageUrl: imageUrl,
      timestamp: new Date()
    };
    renderMessage(tempMsg);
    socket.emit("image:send", { imageUrl, viewOnce: false });
    imageBtn.disabled = false;
    imageBtn.style.opacity = "";
    imageInput.value = "";
  };
reader.readAsDataURL(file);
});

/* ── Socket events ──────────────────────────────────────────────── */
socket.on("messages:history", ({ msgs, hasMore }) => {
  hasMoreMessages = hasMore !== false;
  if (msgs.length > 0) {
    oldestMessageTime = new Date(msgs[0].timestamp);
  }
  msgs.forEach((m, i) => {
    setTimeout(() => renderMessage(m), i * 18);
  });
  setTimeout(() => scrollBottom(true), msgs.length * 18 + 60);
});

socket.on("messages:loadmore", ({ messages, hasMore }) => {
  isLoadingMessages = false;
  if (messages.length > 0) {
    prependMessages(messages);
  }
  hasMoreMessages = hasMore;
});

socket.on("message:new", msg => {
   // Don't show DMs in general chat view
   if (msg.recipientDeviceId && currentChat.type !== "dm") return;
   // Don't show group messages in DM view
   if (!msg.recipientDeviceId && currentChat.type === "dm") return;
   const isMine = msg.senderDeviceId === myDeviceId;
   renderMessage(msg);
   // Mark as seen after render
   if (!isMine) {
     setTimeout(() => {
       socket.emit("message:seen", { messageId: msg._id });
     }, 500);
   }
});

socket.on("message:delivered", ({ messageId }) => {
  const el = document.querySelector(`[data-id="${messageId}"] .msg-status`);
  if (el) el.innerHTML = '<span style="color:#888;">✓✓</span>';
});

socket.on("message:seen", ({ messageId }) => {
  const el = document.querySelector(`[data-id="${messageId}"] .msg-status`);
  if (el) el.innerHTML = '<span style="color:#5ac8fa;">✓✓</span>';
});

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
   
   // Update friends array with latest data from users list
   const friendDeviceIds = friends.map(f => f.deviceId);
   const updatedFriends = friends.map(friend => {
     const updatedUser = users.find(u => u.deviceId === friend.deviceId);
     if (updatedUser) {
       return { ...friend, isOnline: updatedUser.isOnline, lastSeen: updatedUser.lastSeen };
     }
     return friend;
   });
   friends = updatedFriends;
   
   // Separate non-friends and friends from online users
   const nonFriends = users.filter(u => 
     u.deviceId !== myDeviceId && !friends.some(f => f.deviceId === u.deviceId)
   );
   
   userList.innerHTML = "";

   // Always show General channel first (pinned)
   const generalLi = document.createElement("li");
   generalLi.className = "general-chat-item";
   generalLi.style.cursor = "pointer";
   generalLi.style.background = "rgba(0,229,176,0.08)";
   generalLi.style.borderLeft = "2px solid var(--mint)";
   generalLi.style.padding = "10px 12px";
   generalLi.style.marginBottom = "4px";
   generalLi.innerHTML = `<span style="color:var(--mint);font-weight:600;"># general</span>`;
   generalLi.onclick = () => switchToGroupChat();
   userList.appendChild(generalLi);

   // Add Friends section header if there are friends
   if (friends.length > 0) {
     const friendsHeader = document.createElement("li");
     friendsHeader.className = "section-header";
     friendsHeader.style.cssText = "padding:8px 12px 4px;color:var(--tx-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;pointer-events:none;";
     friendsHeader.innerHTML = "<span>Friends</span>";
     userList.appendChild(friendsHeader);
   }

   // Show friends (clickable for DM) - these are private chats
   friends.forEach((friend, i) => {
     const li = document.createElement("li");
     li.className = "friend-item";
     li.style.cursor = "pointer";
     li.style.paddingLeft = "12px";
     li.style.background = friend.isOnline ? "rgba(124,106,247,0.08)" : "rgba(124,106,247,0.04)";
     li.style.borderLeft = "2px solid var(--purple)";
     const statusColor = friend.isOnline ? "var(--mint)" : "var(--tx-muted)";
     const statusText = friend.isOnline ? "● online" : `● ${friend.lastSeen ? formatLastSeenPrecise(new Date(friend.lastSeen)) : 'offline'}`;
     li.innerHTML = `<span style="color:var(--purple);">${esc(friend.username)}</span><span style="color:${statusColor};margin-left:auto;font-size:11px;">${statusText}</span>`;
     li.onclick = () => switchToDM(friend.deviceId, friend.username);
     li.addEventListener('touchend', () => switchToDM(friend.deviceId, friend.username));
     userList.appendChild(li);
   });

   // Online users section (only show online non-friends)
   const onlineNonFriends = nonFriends.filter(u => u.isOnline);
   if (onlineNonFriends.length > 0) {
     const onlineHeader = document.createElement("li");
     onlineHeader.className = "section-header";
     onlineHeader.style.cssText = "padding:8px 12px 4px;color:var(--tx-secondary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;pointer-events:none;margin-top:4px;";
     onlineHeader.innerHTML = "<span>Online</span>";
     userList.appendChild(onlineHeader);
   }

   // Show online non-friends (users you can add)
   onlineNonFriends.forEach((u, i) => {
     const name = u.username || "";
     const deviceId = u.deviceId;
     const li = document.createElement("li");
     li.style.animationDelay = `${i * 45}ms`;

     const av = document.createElement("div");
     av.className = "ul-avatar";
     av.textContent = initials(name);
     av.style.background = colorFor(name);

     const span = document.createElement("span");
     span.className = "ul-name";
     span.textContent = name;

     const addBtn = document.createElement("button");
     addBtn.className = "add-friend-btn";
     addBtn.textContent = "+";
     addBtn.title = "Add friend";
     addBtn.onclick = (e) => {
       e.stopPropagation();
       sendFriendRequest(deviceId);
     };

     li.appendChild(av);
     li.appendChild(span);
     li.appendChild(addBtn);

     // Click to show basic info for online users
     li.onclick = (e) => {
       showUserInfo(name, null, true, e.clientX, e.clientY);
     };

     li.addEventListener('touchend', (e) => {
       const touch = e.changedTouches[0];
       showUserInfo(name, null, true, touch.clientX, touch.clientY);
     });

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

    // Click to show basic info (no lastSeen in this event)
    li.onclick = (e) => {
      showUserInfo(name, null, true, e.clientX, e.clientY);
    };

    // Touch support for mobile
    li.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      showUserInfo(name, null, true, touch.clientX, touch.clientY);
    });

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

/* ── Infinite Scroll ─────────────────────────────────────────────── */
messagesWrap.addEventListener("scroll", () => {
  if (messagesWrap.scrollTop < 50 && hasMoreMessages && !isLoadingMessages && oldestMessageTime) {
    isLoadingMessages = true;
    socket.emit("message:loadmore", { before: oldestMessageTime });
  }
});

/* ── Scroll Controller ─────────────────────────────────────────────── */
(function initScrollController() {
  const ctrl = document.getElementById("scroll-ctrl");
  if (!ctrl) return;
  
  let isDragging = false;
  let startY = 0;
  let startTop = 0;
  let moved = false;
  
  function onDrag(e) {
    if (!isDragging) return;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    const dy = clientY - startY;
    const newTop = startTop + dy;
    
    const maxTop = window.innerHeight - 100;
    const minTop = 100;
    const clampedTop = Math.max(minTop, Math.min(maxTop, newTop));
    
    ctrl.style.top = clampedTop + "px";
    ctrl.style.transform = "none";
    
    const progress = (clampedTop - minTop) / (maxTop - minTop);
    const scrollTop = progress * (messagesWrap.scrollHeight - messagesWrap.clientHeight);
    messagesWrap.scrollTop = Math.max(0, scrollTop);
    
    moved = true;
  }
  
  function onRelease() {
    if (!isDragging) return;
    isDragging = false;
    ctrl.classList.remove("dragging");
    
    if (!moved) {
      messagesWrap.scrollTop = 0;
      ctrl.style.transition = "top 0.4s var(--ease-out), transform 0.4s var(--ease-out)";
      ctrl.style.top = "50%";
      ctrl.style.transform = "translateY(-50%)";
    } else {
      const finalTop = parseInt(ctrl.style.top);
      ctrl.style.transition = "top 0.4s var(--ease-out), transform 0.4s var(--ease-out)";
    }
  }
  
  ctrl.addEventListener("mousedown", (e) => {
    isDragging = true;
    moved = false;
    startY = e.clientY;
    startTop = ctrl.getBoundingClientRect().top;
    ctrl.classList.add("dragging");
    ctrl.style.transition = "none";
    e.preventDefault();
  });
  
  ctrl.addEventListener("touchstart", (e) => {
    isDragging = true;
    moved = false;
    startY = e.touches[0].clientY;
    startTop = ctrl.getBoundingClientRect().top;
    ctrl.classList.add("dragging");
    ctrl.style.transition = "none";
  });
  
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("touchmove", onDrag, { passive: false });
  document.addEventListener("mouseup", onRelease);
  document.addEventListener("touchend", onRelease);
})();

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

/* ── Mobile Sidebar Toggle ────────────────────────────────────────── */
(function initMobileSidebar() {
  const menuBtn = document.getElementById("menu-btn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  
  if (!menuBtn || !sidebar || !overlay) return;
  
  function openSidebar() {
    sidebar.classList.add("open");
    overlay.classList.add("show");
  }
  
  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  }
  
  menuBtn.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });
  
  overlay.addEventListener("click", closeSidebar);
  
  // Close on escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("open")) {
      closeSidebar();
    }
  });
})();

/* ── DM/Friend System ─────────────────────────────────────────────── */
function switchToDM(recipientDeviceId, recipientName) {
   console.log("Opening DM with:", recipientName, recipientDeviceId);
   
   // Clear general chat messages first
   messagesEl.innerHTML = "";
   
   // Set chat type and recipient
   currentChat = { type: "dm", recipientId: recipientDeviceId };
   
   // Find friend's lastSeen from friends list
   const friend = friends.find(f => f.deviceId === recipientDeviceId);
   const lastSeen = friend ? friend.lastSeen : null;
   const isOnline = friend ? friend.isOnline : false;
   const lastSeenText = lastSeen ? formatLastSeenPrecise(new Date(lastSeen)) : "never";
   
   document.getElementById("chat-header").innerHTML = `
     <div class="ch-left">
       <span class="ch-channel" style="color:var(--purple)">${esc(recipientName)}</span>
       <span class="ch-sep">·</span>
       <span class="ch-sub">Direct message</span>
     </div>
     <div class="ch-right">
       <span style="color:var(--tx-muted);font-size:11px;">${isOnline ? 'online' : lastSeenText}</span>
       <button class="icon-btn" onclick="switchToGroupChat()" title="Back to group chat">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <line x1="19" y1="12" x2="5" y2="12"></line>
           <polyline points="12 19 5 12 12 5"></polyline>
         </svg>
       </button>
       <button class="icon-btn" onclick="unfriend('${recipientDeviceId}')" title="Unfriend" style="color:#ff6b6b;">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
           <circle cx="8.5" cy="7" r="4"/>
         </svg>
       </button>
     </div>
   `;
   messageInput.placeholder = `Message ${recipientName}…`;
   socket.emit("dm:load", { recipientId: recipientDeviceId });
 }

function switchToGroupChat() {
   currentChat = { type: "group", recipientId: null };
   document.getElementById("chat-header").innerHTML = `
     <div class="ch-left">
       <span class="ch-hash">#</span>
       <span class="ch-channel">general</span>
       <span class="ch-sep">·</span>
       <span class="ch-sub">Open to everyone</span>
     </div>
     <div class="ch-right">
       <span class="live-dot"></span>
       <span class="live-label">live</span>
       <button id="logout-btn" class="icon-btn" title="Logout" aria-label="Logout" onclick="logout()">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
           <polyline points="16 17 21 12 16 7"/>
           <line x1="21" y1="12" x2="9" y2="12"/>
         </svg>
       </button>
     </div>
   `;
   messagesEl.innerHTML = "";
   messageInput.placeholder = "Message #general…";
   // Reload group chat history
   socket.emit("message:loadHistory");
 }

// Send message handler update
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !myUsername) return;
  
  sendBtn.style.transform = "scale(0.88)";
  setTimeout(() => { sendBtn.style.transform = ""; }, 140);
  
  const payload = { text, replyTo: replyTo || null };
  if (currentChat.type === "dm") {
    payload.recipientId = currentChat.recipientId;
    socket.emit("dm:send", payload);
  } else {
    socket.emit("message:send", payload);
  }
  clearReply();
  messageInput.value = "";
  messageInput.focus();
}

// DM socket handlers
socket.on("dm:new", msg => {
   const isRelevantDM = currentChat.type === "dm" && 
     ((msg.senderDeviceId === currentChat.recipientId && msg.recipientDeviceId === myDeviceId) ||
      (msg.senderDeviceId === myDeviceId && msg.recipientDeviceId === currentChat.recipientId));
   
   if (isRelevantDM) {
     renderMessage(msg);
     if (msg.senderDeviceId !== myDeviceId) {
       socket.emit("message:seen", { messageId: msg._id });
     }
   }
});

socket.on("dm:history", msgs => {
  messagesEl.innerHTML = "";
  msgs.forEach((m, i) => {
    setTimeout(() => renderMessage(m), i * 18);
  });
  scrollBottom(true);
});

// Friend system handlers
socket.on("friend:request", ({ fromDeviceId, fromUsername }) => {
  showFriendRequest(fromDeviceId, fromUsername);
});

socket.on("friend:request:sent", () => {
  appendSystemMsg("Friend request sent");
});

socket.on("friend:accepted", ({ byDeviceId }) => {
  loadFriends();
  socket.emit("user:list");
  // Force UI refresh
  setTimeout(() => {
    socket.emit("user:list");
  }, 300);
  appendSystemMsg("Friend request accepted!");
});

socket.on("friend:rejected", () => {
  loadFriends();
  appendSystemMsg("Friend request rejected");
});

function showFriendRequest(fromDeviceId, fromUsername) {
  const existing = document.getElementById(`fr-${fromDeviceId}`);
  if (existing) return;
  
  const item = document.createElement("div");
  item.id = `fr-${fromDeviceId}`;
  item.className = "friend-request";
  item.innerHTML = `
    <span>${esc(fromUsername)} wants to be friends</span>
    <button onclick="acceptFriend('${fromDeviceId}')">Accept</button>
    <button onclick="rejectFriend('${fromDeviceId}')">Decline</button>
  `;
  document.getElementById("user-list").appendChild(item);
}

function acceptFriend(deviceId) {
  socket.emit("friend:accept", { fromDeviceId: deviceId });
}

function rejectFriend(deviceId) {
   socket.emit("friend:reject", { fromDeviceId: deviceId });
 }

 function unfriend(deviceId) {
   if (confirm("Remove this friend? This will delete all your direct messages.")) {
     socket.emit("friend:unfriend", { friendDeviceId: deviceId });
   }
 }

function loadFriends() {
  socket.emit("friend:list");
}

socket.on("friend:list:data", friendList => {
   friends = friendList || [];
   // Refresh the user list to show friends properly
   socket.emit("user:list");
 });

socket.on("friend:unfriended", ({ friendDeviceId }) => {
   if (currentChat.type === "dm" && currentChat.recipientId === friendDeviceId) {
     switchToGroupChat();
   }
   loadFriends();
   socket.emit("user:list");
   appendSystemMsg("Friend removed");
 });

 socket.on("friend:removed", ({ byDeviceId }) => {
   loadFriends();
   socket.emit("user:list");
   if (currentChat.type === "dm" && currentChat.recipientId === byDeviceId) {
     switchToGroupChat();
   }
 });

function sendFriendRequest(deviceId) {
  socket.emit("friend:request", { toDeviceId: deviceId });
}

window.acceptFriend = acceptFriend;
window.rejectFriend = rejectFriend;
window.unfriend = unfriend;
window.switchToGroupChat = switchToGroupChat;
window.closeGifPicker = closeGifPicker;
window.sendGif = sendGif;