const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const path = require("path");
const User = require("./models/User");
const Message = require("./models/Message");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  path: "/socket.io"
});

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline' data: blob:; img-src * data: blob:;"
  );
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

// Serve static files with no cache
app.use(express.static(__dirname, {
  maxAge: 0,
  etag: false
}));
app.use(express.json({ limit: "10mb" }));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

mongoose.connect(process.env.MONGO_URI || "mongodb+srv://prateek:test12345@cluster0.d63q5xw.mongodb.net/chat?retryWrites=true&w=majority", {
  serverSelectionTimeoutMS: 5000,
}).then(() => console.log("MongoDB connected")).catch(err => {
  console.error("MongoDB connection failed:", err.message);
  console.log("Running without database - features will be limited");
});

console.log("=== SERVER STARTING ===");
console.log("Server will listen on port:", process.env.PORT || 8080);

// Map deviceId to socketId for targeted messaging
const deviceToSocket = new Map();

// Periodic cleanup for stale connections (mark offline after 2 minutes of no activity)
setInterval(async () => {
  try {
    const twoMinutesAgo = new Date(Date.now() - 120000);
    const result = await User.updateMany(
      { isOnline: true, lastSeen: { $lt: twoMinutesAgo } },
      { isOnline: false }
    );
    if (result.modifiedCount > 0) {
      const users = await User.find({});
      const onlineUsers = users.filter(u => u.isOnline === true);
      io.emit("users:update", onlineUsers);
    }
  } catch (err) {
    console.error("Cleanup error:", err.message);
  }
}, 30000);

io.on("connection", (socket) => {
  console.log("=== SERVER: User connected:", socket.id);

  socket.on("user:join", async ({ deviceId, username }) => {
    console.log("=== SERVER: user:join received ===", { deviceId, username });
    try {
      let user = await User.findOne({ deviceId });
      if (user) {
        user.username = username;
        user.isOnline = true;
        user.lastSeen = new Date();
        await user.save();
      } else {
        user = await User.create({ deviceId, username, isOnline: true });
      }

      socket.deviceId = deviceId;
      socket.username = username;
      deviceToSocket.set(deviceId, socket.id);

      const users = await User.find({});
      const onlineUsers = users.filter(u => u.isOnline === true);
      io.emit("users:update", onlineUsers);

      const messages = await Message.find({}).sort({ timestamp: -1 }).limit(20);
      const messagesWithUsername = messages.map(m => {
        const msg = m.toObject();
        msg.username = msg.senderName;
        return msg;
      }).reverse();
      socket.emit("messages:history", { msgs: messagesWithUsername, hasMore: messages.length === 20 });
      socket.emit("join:success", { status: "ok", hasMore: messages.length === 20 });
      console.log("=== SERVER: User joined:", username);
    } catch (err) {
      console.error("Database error:", err.message);
      socket.deviceId = deviceId;
      socket.username = username;
      io.emit("users:update", [{ deviceId, username, isOnline: true }]);
      socket.emit("messages:history", { msgs: [], hasMore: false });
    }
  });

  socket.on("message:send", async (data) => {
    try {
      const message = await Message.create({
        text: data.text,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        type: "chat",
        replyTo: data.replyTo || null
      });
      const msgToSend = message.toObject();
      msgToSend.username = msgToSend.senderName;
      msgToSend.deliveredTo = [];
      io.emit("message:new", msgToSend);
    } catch (err) {
      console.error("Database error on message send:", err.message);
      const message = {
        _id: Date.now().toString(),
        id: Date.now().toString(),
        text: data.text,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        username: socket.username,
        type: "chat",
        timestamp: new Date(),
        replyTo: data.replyTo || null,
        deliveredTo: []
      };
      io.emit("message:new", message);
    }
  });

  socket.on("message:loadmore", async ({ before }) => {
    try {
      const cutoff = new Date(before);
      const messages = await Message.find({ timestamp: { $lt: cutoff } })
        .sort({ timestamp: -1 })
        .limit(20);
      const messagesWithUsername = messages.map(m => {
        const msg = m.toObject();
        msg.username = msg.senderName;
        return msg;
      }).reverse();
      socket.emit("messages:loadmore", {
        messages: messagesWithUsername,
        hasMore: messages.length === 20
      });
    } catch (err) {
      console.error("Load more error:", err.message);
      socket.emit("messages:loadmore", { messages: [], hasMore: false });
    }
  });

  socket.on("message:edit", async ({ messageId, text }) => {
    try {
      const message = await Message.findById(messageId);
      if (message && message.senderDeviceId === socket.deviceId) {
        message.text = text;
        message.edited = true;
        await message.save();
        io.emit("message:edited", message);
      }
    } catch (err) {
      console.error("Database error on message edit:", err.message);
    }
  });

  socket.on("image:send", async (data) => {
    console.log("=== SERVER: image:send received ===", { 
      deviceId: socket.deviceId, 
      username: socket.username,
      hasImageUrl: !!data.imageUrl,
      viewOnce: data.viewOnce
    });
    try {
      const message = await Message.create({
        imageUrl: data.imageUrl,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        type: "image",
        seenBy: [socket.deviceId],
        viewOnce: data.viewOnce || false
      });
      const msgToSend = message.toObject();
      msgToSend.username = msgToSend.senderName;
      io.emit("message:new", msgToSend);
      console.log("=== SERVER: Image saved with id:", message._id);
    } catch (err) {
      console.error("Image send error:", err.message);
      const message = {
        _id: Date.now().toString(),
        id: Date.now().toString(),
        imageUrl: data.imageUrl,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        username: socket.username,
        type: "image",
        timestamp: new Date(),
        seenBy: [socket.deviceId],
        viewOnce: data.viewOnce || false
      };
      io.emit("message:new", message);
    }
  });

  socket.on("message:delivered", async ({ messageId }) => {
    try {
      const message = await Message.findById(messageId);
      if (message && !message.deliveredTo.includes(socket.deviceId)) {
        message.deliveredTo.push(socket.deviceId);
        await message.save();
        const senderSocketId = deviceToSocket.get(message.senderDeviceId);
        if (senderSocketId) {
          io.to(senderSocketId).emit("message:delivered", { messageId });
        }
      }
    } catch (err) {}
  });

  socket.on("message:seen", async ({ messageId }) => {
    try {
      const message = await Message.findById(messageId);
      if (message && !message.seenBy.includes(socket.deviceId)) {
        message.seenBy.push(socket.deviceId);
        await message.save();
        const senderSocketId = deviceToSocket.get(message.senderDeviceId);
        if (senderSocketId) {
          io.to(senderSocketId).emit("message:seen", { messageId });
        }
      }
    } catch (err) {}
  });

  socket.on("disconnect", async (reason) => {
    console.log("=== SERVER: User disconnected:", socket.deviceId, "reason:", reason);
    if (socket.deviceId) {
      deviceToSocket.delete(socket.deviceId);
      try {
        await User.findOneAndUpdate(
          { deviceId: socket.deviceId },
          { isOnline: false, lastSeen: new Date() }
        );
        const users = await User.find({});
        const onlineUsers = users.filter(u => u.isOnline === true);
        io.emit("users:update", onlineUsers);
      } catch (err) {
        console.error("Error on disconnect:", err.message);
        io.emit("users:update", []);
      }
    }
  });

  socket.on("image:seen", async (msgId) => {
    try {
      const message = await Message.findById(msgId);
      if (message && message.type === "image") {
        await Message.findByIdAndDelete(msgId);
        io.emit("message:deleted", msgId);
      }
    } catch (err) {
      const idx = messages.findIndex(m => m.id === msgId || m._id === msgId);
      if (idx !== -1) {
        messages.splice(idx, 1);
        io.emit("message:deleted", msgId);
      }
    }
  });

  socket.on("reaction:add", async ({ messageId, emoji }) => {
    try {
      const message = await Message.findById(messageId);
      if (message) {
        if (!message.reactions) message.reactions = {};
        if (!message.reactions[emoji]) message.reactions[emoji] = [];
        if (!message.reactions[emoji].includes(socket.username)) {
          message.reactions[emoji].push(socket.username);
          await message.save();
          io.emit("reaction:added", { messageId, emoji, username: socket.username });
        }
      }
    } catch (err) {}
  });

  socket.on("message:delete", async ({ messageId }) => {
    try {
      const message = await Message.findById(messageId);
      if (message && message.senderDeviceId === socket.deviceId) {
        const msgTime = new Date(message.timestamp);
        const now = new Date();
        if ((now - msgTime) < 3600000) {
          await Message.findByIdAndDelete(messageId);
          io.emit("message:deleted", messageId);
        }
      }
    } catch (err) {}
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));