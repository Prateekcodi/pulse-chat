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
      const onlineUsers = users.filter(u => u.isOnline === true).map(u => ({
        deviceId: u.deviceId,
        username: u.username,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen
      }));
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
        recipientDeviceId: data.recipientId || null,
        type: "chat",
        replyTo: data.replyTo || null
      });
      const msgToSend = message.toObject();
      msgToSend.username = msgToSend.senderName;
      msgToSend.deliveredTo = [];
      // Send to recipient only for DM, or broadcast for group chat
      if (data.recipientId) {
        io.to(deviceToSocket.get(data.recipientId))?.emit("message:new", msgToSend);
        socket.emit("message:new", msgToSend);
      } else {
        io.emit("message:new", msgToSend);
      }
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
        recipientDeviceId: data.recipientId || null,
        replyTo: data.replyTo || null,
        deliveredTo: []
      };
      if (data.recipientId) {
        io.to(deviceToSocket.get(data.recipientId))?.emit("message:new", message);
        socket.emit("message:new", message);
      } else {
        io.emit("message:new", message);
      }
    }
  });

  // DM-specific handlers
  socket.on("dm:send", async (data) => {
    try {
      const message = await Message.create({
        text: data.text,
        senderDeviceId: socket.deviceId,
        senderName: socket.username,
        recipientDeviceId: data.recipientId,
        type: "chat"
      });
      const msgToSend = message.toObject();
      msgToSend.username = msgToSend.senderName;
      const recipientSocketId = deviceToSocket.get(data.recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("dm:new", msgToSend);
        socket.emit("dm:new", msgToSend);
      } else {
        socket.emit("dm:new", msgToSend);
      }
    } catch (err) {
      console.error("DM send error:", err.message);
    }
  });

  socket.on("dm:load", async ({ recipientId }) => {
    try {
      const messages = await Message.find({
        $or: [
          { senderDeviceId: socket.deviceId, recipientDeviceId: recipientId },
          { senderDeviceId: recipientId, recipientDeviceId: socket.deviceId }
        ]
      }).sort({ timestamp: 1 }).limit(50);
      socket.emit("dm:history", messages);
    } catch (err) {
      socket.emit("dm:history", []);
    }
  });

  // Friend request handlers
  socket.on("friend:request", async ({ toDeviceId }) => {
    try {
      const toUser = await User.findOne({ deviceId: toDeviceId });
      const fromUser = await User.findOne({ deviceId: socket.deviceId });
      if (toUser && !toUser.friendRequests.includes(socket.deviceId)) {
        toUser.friendRequests.push(socket.deviceId);
        fromUser.sentRequests.push(toDeviceId);
        await toUser.save();
        await fromUser.save();
        const targetSocketId = deviceToSocket.get(toDeviceId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("friend:request", {
            fromDeviceId: socket.deviceId,
            fromUsername: socket.username
          });
        }
        socket.emit("friend:request:sent", { toDeviceId });
      }
    } catch (err) {
      console.error("Friend request error:", err.message);
    }
  });

  socket.on("friend:accept", async ({ fromDeviceId }) => {
    try {
      const me = await User.findOne({ deviceId: socket.deviceId });
      const from = await User.findOne({ deviceId: fromDeviceId });
      if (me && from) {
        me.friends.push(fromDeviceId);
        from.friends.push(socket.deviceId);
        me.friendRequests = me.friendRequests.filter(id => id !== fromDeviceId);
        from.sentRequests = from.sentRequests.filter(id => id !== socket.deviceId);
        await me.save();
        await from.save();
        io.to(deviceToSocket.get(fromDeviceId))?.emit("friend:accepted", { byDeviceId: socket.deviceId });
        
        // Send updated friend lists to both users
        const myFriends = await User.find({ deviceId: { $in: me.friends } });
        socket.emit("friend:list:data", myFriends);
        
        const fromFriends = await User.find({ deviceId: { $in: from.friends } });
        io.to(deviceToSocket.get(fromDeviceId))?.emit("friend:list:data", fromFriends);
        
        // Refresh user lists for both
        const users = await User.find({});
        const onlineUsers = users.filter(u => u.isOnline === true).map(u => ({
          deviceId: u.deviceId,
          username: u.username,
          isOnline: u.isOnline,
          lastSeen: u.lastSeen
        }));
        io.emit("users:update", onlineUsers);
      }
    } catch (err) {
      console.error("Friend accept error:", err.message);
    }
  });

  socket.on("friend:reject", async ({ fromDeviceId }) => {
    try {
      const me = await User.findOne({ deviceId: socket.deviceId });
      const from = await User.findOne({ deviceId: fromDeviceId });
      if (me && from) {
        me.friendRequests = me.friendRequests.filter(id => id !== fromDeviceId);
        from.sentRequests = from.sentRequests.filter(id => id !== socket.deviceId);
        await me.save();
        await from.save();
        io.to(deviceToSocket.get(fromDeviceId))?.emit("friend:rejected", { byDeviceId: socket.deviceId });
        socket.emit("friend:updated");
        socket.emit("friends:updated");
        io.to(deviceToSocket.get(fromDeviceId))?.emit("friends:updated");
        // Refresh user lists
        const users = await User.find({});
        const onlineUsers = users.filter(u => u.isOnline === true).map(u => ({
          deviceId: u.deviceId,
          username: u.username,
          isOnline: u.isOnline,
          lastSeen: u.lastSeen
        }));
        io.emit("users:update", onlineUsers);
      }
    } catch (err) {
      console.error("Friend reject error:", err.message);
    }
  });

socket.on("friend:list", async () => {
     try {
       const user = await User.findOne({ deviceId: socket.deviceId });
       if (user) {
         const friendsWithInfo = await User.find({ deviceId: { $in: user.friends } });
         socket.emit("friend:list:data", friendsWithInfo);
       }
     } catch (err) {
       socket.emit("friend:list:data", []);
     }
   });

 socket.on("user:list", async () => {
   const user = await User.findOne({ deviceId: socket.deviceId });
   if (user) {
     // Get all users including friends who are offline
     const allUsers = await User.find({});
     const result = allUsers.map(u => ({
       deviceId: u.deviceId,
       username: u.username,
       isOnline: u.isOnline,
       lastSeen: u.lastSeen
     }));
     socket.emit("users:update", result);
   }
 });

 socket.on("message:loadHistory", async () => {
   try {
     const messages = await Message.find({}).sort({ timestamp: -1 }).limit(20);
     const messagesWithUsername = messages.map(m => {
       const msg = m.toObject();
       msg.username = msg.senderName;
       return msg;
     }).reverse();
     socket.emit("messages:history", { msgs: messagesWithUsername, hasMore: messages.length === 20 });
   } catch (err) {
     socket.emit("messages:history", { msgs: [], hasMore: false });
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
        const onlineUsers = users.filter(u => u.isOnline === true).map(u => ({
          deviceId: u.deviceId,
          username: u.username,
          isOnline: u.isOnline,
          lastSeen: u.lastSeen
        }));
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

   // Unfriend handler - removes friend and deletes DM messages
   socket.on("friend:unfriend", async ({ friendDeviceId }) => {
     try {
       const me = await User.findOne({ deviceId: socket.deviceId });
       const friend = await User.findOne({ deviceId: friendDeviceId });
       if (me && friend) {
         // Remove from each other's friend lists
         me.friends = me.friends.filter(id => id !== friendDeviceId);
         friend.friends = friend.friends.filter(id => id !== socket.deviceId);
         await me.save();
         await friend.save();
         
         // Delete all DM messages between the two users
         await Message.deleteMany({
           $or: [
             { senderDeviceId: socket.deviceId, recipientDeviceId: friendDeviceId },
             { senderDeviceId: friendDeviceId, recipientDeviceId: socket.deviceId }
           ]
         });
         
         // Notify the other user if they're online
         io.to(deviceToSocket.get(friendDeviceId))?.emit("friend:removed", { byDeviceId: socket.deviceId });
         
         // Send updated friend lists
         const myFriends = await User.find({ deviceId: { $in: me.friends } });
         socket.emit("friend:list:data", myFriends);
         
         const friendFriends = await User.find({ deviceId: { $in: friend.friends } });
         io.to(deviceToSocket.get(friendDeviceId))?.emit("friend:list:data", friendFriends);
         
         // Refresh user lists
         const users = await User.find({});
         const onlineUsers = users.filter(u => u.isOnline === true).map(u => ({
           deviceId: u.deviceId,
           username: u.username,
           isOnline: u.isOnline,
           lastSeen: u.lastSeen
         }));
         io.emit("users:update", onlineUsers);
         
         socket.emit("friend:unfriended", { friendDeviceId });
       }
     } catch (err) {
       console.error("Unfriend error:", err.message);
     }
   });
 });

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));