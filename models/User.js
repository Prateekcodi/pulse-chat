const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  friends: [{ type: String }], // Array of friend deviceIds
  friendRequests: [{ type: String }], // Incoming friend requests
  sentRequests: [{ type: String }] // Outgoing friend requests
});

module.exports = mongoose.model("User", userSchema);