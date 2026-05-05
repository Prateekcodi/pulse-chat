const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  text: { type: String },
  senderDeviceId: { type: String, required: true },
  senderName: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  type: { type: String, enum: ["chat", "image"], default: "chat" },
  imageUrl: { type: String },
  seenBy: [{ type: String }],
  reactions: { type: mongoose.Schema.Types.Mixed, default: {} }
});

module.exports = mongoose.model("Message", messageSchema);