const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);