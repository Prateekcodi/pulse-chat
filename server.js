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
  pingInterval: 25000
});

app.use(express.static(__dirname));
app.use(express.json({ limit: "10mb" }));

mongoose.connect(process.env.MONGO_URI || "mongodb+srv://prateek:test12345@cluster0.d63q5xw.mongodb.net/chat?retryWrites=true&w=majority", {
  serverSelectionTimeoutMS: 5000,
}).then(() => console.log("MongoDB connected")).catch(err => {
  console.error("MongoDB connection failed:", err.message);
  console.log("Running without database - features will be limited");
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id, "from", socket.handshake.address);

  socket.on("user:join", async ({ deviceId, username }) => {
    console.log("User joining:", username, "deviceId:", deviceId);
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

      io.emit("users:update", await User.find({}));

      const messages = await Message.find({}).sort({ timestamp: 1 });
      socket.emit("messages:history", messages);
      console.log("User joined successfully:", username);
    } catch (err) {
      console.error("Database error on user join:", err.message);
      socket.deviceId = deviceId;
      socket.username = username;
      io.emit("users:update", [{ deviceId, username, isOnline: true, lastSeen: new Date() }]);
      socket.emit("messages:history", []);
    }
  });

  socket.on("message:send", async (data) => {
    try {
      const message = await Message.create({
        text: data.text,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        type: "text"
      });
      io.emit("message:new", message);
    } catch (err) {
      console.error("Database error on message send:", err.message);
      // Fallback: emit message without persistence
      const message = {
        _id: Date.now().toString(),
        text: data.text,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        type: "text",
        timestamp: new Date()
      };
      io.emit("message:new", message);
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
      // For edit, we can't really do a fallback without knowing the original message
    }
  });

  socket.on("image:send", async (data) => {
    try {
      const message = await Message.create({
        imageUrl: data.imageUrl,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        type: "image",
        seenBy: [socket.deviceId]
      });
      io.emit("message:new", message);
    } catch (err) {
      console.error("Database error on image send:", err.message);
      // Fallback: emit message without persistence
      const message = {
        _id: Date.now().toString(),
        imageUrl: data.imageUrl,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        type: "image",
        timestamp: new Date(),
        seenBy: [socket.deviceId]
      };
      io.emit("message:new", message);
    }
  });

  socket.on("image:seen", async (messageId) => {
    try {
      const message = await Message.findById(messageId);
      if (message && message.senderDeviceId !== socket.deviceId) {
        if (!message.seenBy.includes(socket.deviceId)) {
          message.seenBy.push(socket.deviceId);
          await message.save();

          const allUsers = await User.find({});
          const otherUsers = allUsers.filter(u => u.deviceId !== message.senderDeviceId);
          const allSeen = otherUsers.every(u => message.seenBy.includes(u.deviceId));

          if (allSeen) {
            await Message.findByIdAndDelete(messageId);
            io.emit("message:deleted", messageId);
          }
        }
      }
    } catch (err) {
      console.error("Database error on image seen:", err.message);
      // For image seen, we can't really do a fallback since we need the message data
    }
  });

  socket.on("disconnect", async () => {
    if (socket.deviceId) {
      try {
        await User.findOneAndUpdate(
          { deviceId: socket.deviceId },
          { isOnline: false, lastSeen: new Date() }
        );
        io.emit("users:update", await User.find({}));
      } catch (err) {
        console.error("Database error on disconnect:", err.message);
        // Fallback: basic user update
        io.emit("users:update", [{ deviceId: socket.deviceId, username: socket.username, isOnline: false, lastSeen: new Date() }]);
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));