const mongoose = require('mongoose');

// ─── Room Schema ───────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  accessCodeHash: {
    type: String,
    required: true
  },
  title: {
    type: String,
    default: 'Untitled Document',
    maxlength: 80
  },
  createdBy: {
    type: String,
    required: true
  },
  content: {
    type: String,
    default: ''
  },
  version: {
    type: Number,
    default: 0
  },
  activeUsers: [{
    userId: String,
    name: String,
    color: String,
    joinedAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now }
  }],
  activity: [{
    user: String,
    action: String,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

roomSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Trim activity log to last 20 entries
roomSchema.methods.addActivity = function (user, action) {
  this.activity.unshift({ user, action, timestamp: new Date() });
  if (this.activity.length > 20) this.activity.length = 20;
};

const Room = mongoose.model('Room', roomSchema);

module.exports = { Room };