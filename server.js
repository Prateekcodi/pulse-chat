const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.static(__dirname));
app.use(express.json({ limit: "10mb" }));

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/pulsechat", {
}).then(() => console.log("MongoDB connected"));

const messageSchema = new mongoose.Schema({
  id: String,
  type: String,
  username: String,
  text: String,
  url: String,
  caption: String,
  timestamp: Number,
  expiresAt: Number,
  viewedBy: [String],
});

const Message = mongoose.model("Message", messageSchema);

const userSchema = new mongoose.Schema({
  username: String,
  socketId: String,
  lastSeen: Number,
});

const User = mongoose.model("User", userSchema);

const activeUsers = {};

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("user:join", async (username) => {
    activeUsers[socket.id] = { username, lastSeen: Date.now() };
    
    await User.findOneAndUpdate(
      { username },
      { username, socketId: socket.id, lastSeen: Date.now() },
      { upsert: true, new: true }
    );

    const history = await Message.find({}).sort({ timestamp: 1 });
    socket.emit("message:history", history);

    io.emit("server:message", {
      type: "system",
      text: `${username} joined the chat`,
      timestamp: Date.now(),
    });

    io.emit("server:users", Object.values(activeUsers).map(u => ({ username: u.username, lastSeen: u.lastSeen })));
  });

  socket.on("user:message", async (data) => {
    const user = activeUsers[socket.id];
    if (!user) return;

    const msgId = crypto.randomBytes(8).toString("hex");
    const msgData = {
      type: "chat",
      id: msgId,
      username: user.username,
      text: data.text,
      timestamp: Date.now(),
      status: "sent"
    };

    await Message.create(msgData);
    io.emit("server:message", msgData);
  });

  socket.on("message:edit", async (data) => {
    const msg = await Message.findOneAndUpdate(
      { id: data.id, username: activeUsers[socket.id]?.username },
      { text: data.text },
      { new: true }
    );
    if (msg) io.emit("message:edited", msg);
  });

  socket.on("message:delete", async (msgId) => {
    const msg = await Message.findOne({ id: msgId });
    if (msg && msg.username === activeUsers[socket.id]?.username) {
      const canDelete = Date.now() - msg.timestamp < 3600000;
      if (canDelete) {
        await Message.deleteOne({ id: msgId });
        io.emit("message:deleted", msgId);
      }
    }
  });

  socket.on("message:react", async (data) => {
    const msg = await Message.findOneAndUpdate(
      { id: data.msgId },
      { $set: { [`reactions.${data.emoji}`]: socket.id } },
      { new: true }
    );
    if (msg) io.emit("message:reacted", msg);
  });

  socket.on("user:image", async (data) => {
    const user = activeUsers[socket.id];
    if (!user) return;

    const msgId = crypto.randomBytes(8).toString("hex");
    const msgData = {
      type: "image",
      id: msgId,
      username: user.username,
      url: data.url,
      caption: data.caption || "",
      timestamp: Date.now(),
      expiresAt: data.expiresAt,
      viewedBy: [],
      status: "sent"
    };

    await Message.create(msgData);
    io.emit("server:message", msgData);
  });

  socket.on("message:view", async (msgId) => {
    const msg = await Message.findOne({ id: msgId });
    if (msg && msg.expiresAt && !msg.viewedBy.includes(socket.id)) {
      msg.viewedBy.push(socket.id);
      await msg.save();
      
      if (msg.viewedBy.length >= (await User.countDocuments())) {
        setTimeout(() => {
          io.emit("message:deleted", msgId);
          Message.deleteOne({ id: msgId });
        }, 1000);
      }
    }
  });

  socket.on("message:seen", (msgId) => {
    socket.broadcast.emit("message:status", { id: msgId, status: "seen" });
  });

  socket.on("disconnect", () => {
    const user = activeUsers[socket.id];
    if (user) {
      User.findOneAndUpdate(
        { username: user.username },
        { lastSeen: Date.now(), socketId: "" }
      );
      delete activeUsers[socket.id];
      console.log(`${user.username} left (${socket.id})`);

      io.emit("server:message", {
        type: "system",
        text: `${user.username} left the chat`,
        timestamp: Date.now(),
      });

      io.emit("server:users", Object.values(activeUsers).map(u => ({ username: u.username, lastSeen: u.lastSeen })));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});