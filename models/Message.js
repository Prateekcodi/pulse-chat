const mongoose = require("mongoose");

const replySchema = new mongoose.Schema({
  id: { type: String },
  username: { type: String },
  text: { type: String }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  text: { type: String },
  senderDeviceId: { type: String, required: true },
  senderName: { type: String, required: true },
  recipientDeviceId: { type: String }, // null for group chat, set for DM
  timestamp: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  type: { type: String, enum: ["chat", "image"], default: "chat" },
  imageUrl: { type: String },
  seenBy: [{ type: String }],
  deliveredTo: [{ type: String }],
  reactions: { type: mongoose.Schema.Types.Mixed, default: {} },
  replyTo: replySchema,
  viewOnce: { type: Boolean, default: false },
  viewedAt: [{ deviceId: { type: String }, time: { type: Date } }]
});

module.exports = mongoose.model("Message", messageSchema);