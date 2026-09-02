const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  recipientUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  recipientName: {
    type: String,
    default: '',
  },
  userName: {
    type: String,
    required: true,
  },
  userAvatar: {
    type: String,
    default: '',
  },
  assignedBy: {
    type: String,
    default: '',
  },
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
  },
  taskDescription: {
    type: String,
    required: true,
  },
  taskType: {
    type: String,
    default: 'general',
  },
  type: {
    type: String,
    enum: [
      'task_completed',
      'task_in_progress',
      'task_assigned',
      'remark_added',
      'user_registered',
      'user_approved',
      'user_rejected',
    ],
    default: 'task_completed',
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  remark: {
    type: String,
    default: '',
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  forRole: {
    type: String,
    enum: ['Manager', 'User', 'All'],
    default: 'Manager',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
