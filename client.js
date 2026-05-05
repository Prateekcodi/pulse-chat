const socket = io({ transports: ["websocket"] });

console.log("client.js loaded, socket created");

let myDeviceId = localStorage.getItem("deviceId");
if (!myDeviceId) {
  myDeviceId = crypto.randomUUID();
  localStorage.setItem("deviceId", myDeviceId);
}

socket.on("connect", () => {
  console.log("Socket connected:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("Socket connection error:", err.message);
  alert("Failed to connect to server. Please refresh the page.");
});

socket.on("disconnect", (reason) => {
  console.log("Socket disconnected:", reason);
});

socket.on("connect_timeout", (timeout) => {
  console.error("Connection timeout:", timeout);
});

const loginOverlay = document.getElementById("login-overlay");
const usernameInput = document.getElementById("username-input");
const joinBtn = document.getElementById("join-btn");
const app = document.getElementById("app");
const messagesEl = document.getElementById("messages");
const messagesContainer = document.getElementById("messages-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const userList = document.getElementById("user-list");
const userCountEl = document.getElementById("user-count");
const imageInput = document.getElementById("image-input");
const imageBtn = document.getElementById("image-btn");
const headerUsername = document.getElementById("header-username");

function joinChat() {
  const name = usernameInput.value.trim();
  if (!name) return;
  console.log("Joining chat with name:", name);
  
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining...";
  
  socket.emit("user:join", { deviceId: myDeviceId, username: name }, (response) => {
    joinBtn.disabled = false;
    joinBtn.textContent = "Join";
  });
  
  headerUsername.textContent = name;
  loginOverlay.classList.add("hidden");
  app.classList.remove("hidden");
  messageInput.focus();
}

joinBtn.addEventListener("click", joinChat);
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinChat();
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

sendBtn.addEventListener("click", sendMessage);

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit("message:send", { text });
  messageInput.value = "";
}

imageBtn.addEventListener("click", () => imageInput.click());

imageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    socket.emit("image:send", { imageUrl: ev.target.result });
  };
  reader.readAsDataURL(file);
});

socket.on("messages:history", (messages) => {
  messages.forEach(renderMessage);
  scrollToBottom();
});

socket.on("message:new", renderMessage);

socket.on("message:edited", updateMessage);

socket.on("message:deleted", (msgId) => {
  const el = document.querySelector(`[data-id="${msgId}"]`);
  if (el) el.remove();
});

socket.on("users:update", (users) => {
  userCountEl.textContent = users.length;
  userList.innerHTML = "";
  users.forEach(user => {
    const li = document.createElement("li");
    li.className = user.isOnline ? "online" : "offline";
    li.innerHTML = `
      <span class="online-dot" style="background:${user.isOnline ? '#4ade80' : '#555'}"></span>
      <span>${user.username}</span>
      <span class="last-seen">${user.isOnline ? 'online' : formatLastSeen(user.lastSeen)}</span>
    `;
    userList.appendChild(li);
  });
});

function renderMessage(msg) {
  const isMine = msg.senderDeviceId === myDeviceId;
  const div = document.createElement("div");
  div.className = `msg ${isMine ? "msg-mine" : "msg-other"}`;
  div.dataset.id = msg._id;

  if (msg.type === "image") {
    div.innerHTML = `
      <div class="msg-header">${msg.senderName} • ${formatTime(msg.timestamp)}</div>
      <img src="${msg.imageUrl}" style="max-width:200px;cursor:pointer" onclick="viewImage('${msg._id}', '${msg.imageUrl}')">
    `;
  } else {
    div.innerHTML = `
      <div class="msg-header">
        ${msg.senderName} • ${formatTime(msg.timestamp)} ${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}
      </div>
      <div class="msg-text" ${isMine ? 'contenteditable="true" data-action="edit"' : ''}>${escapeHtml(msg.text)}</div>
      ${isMine ? '<div class="msg-actions"><button class="action-btn" onclick="editMessage(\'' + msg._id + '\')">✏️</button></div>' : ''}
    `;
  }
  messagesEl.appendChild(div);
  scrollToBottom();
}

function updateMessage(msg) {
  const el = document.querySelector(`[data-id="${msg._id}"] .msg-text`);
  if (el) {
    el.textContent = msg.text;
    const header = el.closest(".msg").querySelector(".msg-header");
    if (!header.innerHTML.includes("edited")) {
      header.innerHTML += ' <span class="msg-edited">(edited)</span>';
    }
  }
}

function editMessage(msgId) {
  const textEl = document.querySelector(`[data-id="${msgId}"] .msg-text`);
  const newText = prompt("Edit message:", textEl.textContent);
  if (newText !== null) {
    socket.emit("message:edit", { messageId: msgId, text: newText });
  }
}

function viewImage(msgId, url) {
  socket.emit("image:seen", msgId);
  window.open(url, "_blank");
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLastSeen(ts) {
  if (!ts) return "never";
  const diff = Date.now() - new Date(ts);
  if (diff < 60000) return "now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  return Math.floor(diff / 3600000) + "h ago";
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

let deferredPrompt;
const isFirstVisit = !localStorage.getItem("pwaDismissed");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (isFirstVisit) showInstallBanner();
});

function showInstallBanner() {
  if (!isFirstVisit) return;
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