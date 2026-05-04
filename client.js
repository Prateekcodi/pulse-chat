/* ── State ──────────────────────────────────────────────────────────── */
let myUsername = null;
let mySocketId = null;
let viewedPhotos = new Set();

/* ── DOM refs ───────────────────────────────────────────────────────── */
const loginOverlay      = document.getElementById("login-overlay");
const usernameInput     = document.getElementById("username-input");
const joinBtn           = document.getElementById("join-btn");
const app               = document.getElementById("app");
const userList          = document.getElementById("user-list");
const userCountEl       = document.getElementById("user-count");
const messagesEl        = document.getElementById("messages");
const messagesContainer = document.getElementById("messages-container");
const messageInput      = document.getElementById("message-input");
const sendBtn           = document.getElementById("send-btn");
const headerUsername    = document.getElementById("header-username");

/* ── Socket ──────────────────────────────────────────────────────────── */
const socket = io();

/* ── Colour palette for avatars ─────────────────────────────────────── */
const AVATAR_COLORS = [
  "#7c6af7", "#3ecf8e", "#f0a732", "#e05c5c",
  "#4cb8f5", "#c47cf7", "#f76a6a", "#5cb8a8",
];

function colorForName(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

/* ── Time helpers ────────────────────────────────────────────────────── */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLastSeen(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/* ── Auto-scroll ────────────────────────────────────────────────────── */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/* ── Screenshot protection overlay ──────────────────────────────────── */
function showProtectedImage(url, msgId) {
  const modal = document.createElement("div");
  modal.className = "image-modal";
  modal.innerHTML = `
    <div class="image-modal-content">
      <img src="${url}" class="protected-image" id="protected-${msgId}">
      <div class="screenshot-guard" id="guard-${msgId}"></div>
      <button class="close-modal" id="close-modal-${msgId}">✕</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  document.getElementById(`close-modal-${msgId}`).onclick = () => modal.remove();
  
  const img = document.getElementById(`protected-${msgId}`);
  const guard = document.getElementById(`guard-${msgId}`);
  
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.filter = "blur(8px)";
    ctx.drawImage(img, 0, 0);
    guard.style.backgroundImage = `url(${canvas.toDataURL()})`;
  };

  socket.emit("message:view", msgId);
  viewedPhotos.add(msgId);
}

/* ── Render a chat message ──────────────────────────────────────────── */
function appendMessage(data, isHistory = false) {
  if (data.type === "system") {
    const el = document.createElement("div");
    el.className = "msg-system";
    el.textContent = `— ${data.text} —`;
    messagesEl.appendChild(el);
    if (!isHistory) scrollToBottom();
    return;
  }

  const isMine = data.username === myUsername;
  const color = colorForName(data.username);
  const alignClass = isMine ? "msg-mine" : "msg-other";
  
  const div = document.createElement("div");
  div.className = `msg ${alignClass}`;
  div.dataset.msgId = data.id || "";
  
  let content = "";
  
  if (data.type === "image") {
    const isOneTime = data.expiresAt;
    const alreadyViewed = viewedPhotos.has(data.id);
    
    if (isOneTime && alreadyViewed) {
      content = `<div class="msg-text">🖼️ Photo (viewed & deleted)</div>`;
    } else if (isOneTime) {
      content = `
        <div class="msg-body">
          <div class="msg-header">
            <span class="msg-username" style="color:${color}">${escapeHtml(data.username)}</span>
            <span class="msg-time">${formatTime(data.timestamp)}</span>
          </div>
          <div class="one-time-photo" data-action="view" data-url="${data.url}" data-id="${data.id}">
            <span>📸 One-time Photo - Click to view</span>
          </div>
        </div>
      `;
    } else {
      content = `
        <div class="msg-body">
          <div class="msg-header">
            <span class="msg-username" style="color:${color}">${escapeHtml(data.username)}</span>
            <span class="msg-time">${formatTime(data.timestamp)}</span>
          </div>
          <div class="msg-image-container">
            <img src="${data.url}" alt="shared image" class="msg-image" data-action="view" data-url="${data.url}" data-id="${data.id}">
          </div>
          ${data.caption ? `<div class="msg-caption">${escapeHtml(data.caption)}</div>` : ""}
          ${isMine ? `<div class="msg-status">${renderTicks(data.status)}</div>` : ""}
        </div>
      `;
    }
  } else {
    const withinHour = Date.now() - data.timestamp < 3600000;
    content = `
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-username" style="color:${color}">${escapeHtml(data.username)}</span>
          <span class="msg-time">${formatTime(data.timestamp)}</span>
        </div>
        <div class="msg-text" data-action="edit" data-id="${data.id}">${escapeHtml(data.text)}</div>
        ${data.reactions ? `<div class="msg-reactions">${renderReactions(data.reactions)}</div>` : ""}
        ${isMine ? `<div class="msg-status">${renderTicks(data.status)}</div>` : ""}
        ${isMine && withinHour ? `
        <div class="msg-actions">
          <span class="action-btn" data-action="edit" data-id="${data.id}">✏️</span>
          <span class="action-btn" data-action="delete" data-id="${data.id}">🗑️</span>
        </div>` : ""}
        <div class="reaction-picker" data-action="react" data-id="${data.id}">
          <span>👍</span><span>❤️</span><span>😂</span><span>😮</span>
        </div>
      </div>
    `;
  }
  
  div.innerHTML = content;
  
  div.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", (e) => {
      const action = el.dataset.action;
      const id = el.dataset.id;
      const url = el.dataset.url;
      
      if (action === "edit") {
        const textEl = div.querySelector(".msg-text");
        editMessage(id, textEl.textContent);
      } else if (action === "delete") {
        deleteMessage(id);
      } else if (action === "view") {
        showProtectedImage(url, id);
      } else if (action === "react") {
        const picker = el;
        picker.classList.toggle("show");
        picker.querySelectorAll("span").forEach(emojiEl => {
          emojiEl.onclick = (ev) => {
            addReaction(id, emojiEl.textContent);
            picker.classList.remove("show");
          };
        });
      }
    });
  });
  
  messagesEl.appendChild(div);
  if (!isHistory) scrollToBottom();
}

function renderTicks(status) {
  if (status === "sent") return "✓";
  if (status === "delivered") return "✓✓";
  if (status === "seen") return '<span class="tick-seen">✓✓</span>';
  return "";
}

function renderReactions(reactions) {
  return Object.entries(reactions || {}).map(([emoji]) => 
    `<span class="reaction-badge">${emoji}</span>`
  ).join("");
}

/* ── Message actions ─────────────────────────────────────────────────── */
function editMessage(msgId) {
  const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  
  const textEl = msgEl.querySelector(".msg-text");
  const originalText = textEl.textContent;
  
  textEl.contentEditable = "true";
  textEl.focus();
  textEl.classList.add("editing");
  
  const saveEdit = () => {
    const newText = textEl.textContent.trim();
    if (newText && newText !== originalText) {
      socket.emit("message:edit", { id: msgId, text: newText });
    } else {
      textEl.textContent = originalText;
    }
    textEl.contentEditable = "false";
    textEl.classList.remove("editing");
    textEl.removeEventListener("blur", saveEdit);
    textEl.removeEventListener("keydown", handleKey);
  };
  
  const handleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      textEl.blur();
    } else if (e.key === "Escape") {
      textEl.textContent = originalText;
      textEl.blur();
    }
  };
  
  textEl.addEventListener("blur", saveEdit);
  textEl.addEventListener("keydown", handleKey);
}

function deleteMessage(msgId) {
  socket.emit("message:delete", msgId);
}

function addReaction(msgId, emoji) {
  socket.emit("message:react", { msgId, emoji });
}

/* ── Render user list ───────────────────────────────────────────────── */
function renderUsers(users) {
  userCountEl.textContent = users.length;
  userList.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    const name = u.username;
    if (name === myUsername) li.classList.add("is-me");
    const color = colorForName(name);
    li.innerHTML = `
      <div class="avatar" style="background:${color}">${initials(name)}</div>
      <span class="name-label">${escapeHtml(name)}</span>
      <span class="online-dot"></span>
      <span class="last-seen">${formatLastSeen(u.lastSeen)}</span>
    `;
    userList.appendChild(li);
  });
}

/* ── XSS protection ─────────────────────────────────────────────────── */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ── Join flow ──────────────────────────────────────────────────────── */
function joinChat() {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.focus();
    usernameInput.style.borderColor = "var(--red)";
    setTimeout(() => (usernameInput.style.borderColor = ""), 800);
    return;
  }

  myUsername = name;
  headerUsername.textContent = name;

  loginOverlay.classList.add("fade-out");
  setTimeout(() => {
    loginOverlay.style.display = "none";
    app.classList.remove("hidden");
    messageInput.focus();
  }, 400);

  socket.emit("user:join", name);
}

joinBtn.addEventListener("click", joinChat);
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinChat();
});

/* ── Send message ───────────────────────────────────────────────────── */
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !myUsername) return;
  socket.emit("user:message", { text });
  messageInput.value = "";
  messageInput.focus();
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

/* ── Image upload ────────────────────────────────────────────────────── */
let imageInput = null;
function setupImageUpload() {
  imageInput = document.createElement("input");
  imageInput.type = "file";
  imageInput.accept = "image/*";
  imageInput.style.display = "none";
  imageInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const isOneTime = confirm("Send as one-time photo? (Deletes after all users view)");
      socket.emit("user:image", { 
        url: e.target.result, 
        caption: "",
        expiresAt: isOneTime ? Date.now() + 86400000 : null
      });
    };
    reader.readAsDataURL(file);
  });
  document.body.appendChild(imageInput);
  
  const imageBtn = document.getElementById("image-btn");
  imageBtn.addEventListener("click", () => imageInput.click());
  
  messageInput.addEventListener("paste", (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = (e) => {
          socket.emit("user:image", { url: e.target.result, caption: "" });
        };
        reader.readAsDataURL(blob);
      }
    }
  });
}

/* ── Socket events ──────────────────────────────────────────────────── */
socket.on("connect", () => {
  mySocketId = socket.id;
});

socket.on("message:history", (messages) => {
  messages.forEach(msg => appendMessage(msg, true));
  scrollToBottom();
});

socket.on("server:message", (data) => {
  if (data.type !== "system") {
    data.status = data.status || "sent";
    socket.emit("message:seen", data.id);
  }
  appendMessage(data);
});

socket.on("server:users", renderUsers);

socket.on("message:status", (data) => {
  const msgEl = document.querySelector(`[data-msg-id="${data.id}"]`);
  if (msgEl) {
    const statusEl = msgEl.querySelector(".msg-status");
    if (statusEl) statusEl.innerHTML = renderTicks(data.status);
  }
});

socket.on("message:edited", (msg) => {
  const msgEl = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (msgEl) {
    const textEl = msgEl.querySelector(".msg-text");
    if (textEl) textEl.textContent = msg.text;
  }
});

socket.on("message:reacted", (msg) => {
  const msgEl = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (msgEl) {
    let reactEl = msgEl.querySelector(".msg-reactions");
    if (!reactEl) {
      reactEl = document.createElement("div");
      reactEl.className = "msg-reactions";
      msgEl.querySelector(".msg-body").appendChild(reactEl);
    }
    reactEl.innerHTML = renderReactions(msg.reactions);
  }
});

socket.on("message:deleted", (msgId) => {
  const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (msgEl) msgEl.remove();
});

socket.on("connect_error", () => {
  const div = document.createElement("div");
  div.className = "msg-system";
  div.textContent = "— connection lost, retrying… —";
  messagesEl.appendChild(div);
});

/* ── Initialize ─────────────────────────────────────────────────────── */
setupImageUpload();
window.addEventListener("load", () => usernameInput.focus());