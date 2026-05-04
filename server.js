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
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));
app.use(express.json({ limit: "10mb" }));

mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/chatapp", {
}).then(() => console.log("MongoDB connected"));

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("user:join", async ({ deviceId, username }) => {
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
  });

  socket.on("message:send", async (data) => {
    const message = await Message.create({
      text: data.text,
      senderDeviceId: socket.deviceId,
      senderName: socket.username,
      type: "text"
    });
    io.emit("message:new", message);
  });

  socket.on("message:edit", async ({ messageId, text }) => {
    const message = await Message.findById(messageId);
    if (message && message.senderDeviceId === socket.deviceId) {
      message.text = text;
      message.edited = true;
      await message.save();
      io.emit("message:edited", message);
    }
  });

  socket.on("image:send", async (data) => {
    const message = await Message.create({
      imageUrl: data.imageUrl,
      senderDeviceId: socket.deviceId,
      senderName: socket.username,
      type: "image",
      seenBy: [socket.deviceId]
    });
    io.emit("message:new", message);
  });

  socket.on("image:seen", async (messageId) => {
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
  });

  socket.on("disconnect", async () => {
    if (socket.deviceId) {
      await User.findOneAndUpdate(
        { deviceId: socket.deviceId },
        { isOnline: false, lastSeen: new Date() }
      );
      io.emit("users:update", await User.find({}));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));