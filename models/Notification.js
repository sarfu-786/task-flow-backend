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
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
  },
  leadReadableId: {
    type: String,
    default: '',
  },
  complaintId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Complaint',
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
  },
  taskDescription: {
    type: String,
    default: '',
  },
  taskType: {
    type: String,
    default: 'general',
  },
  type: {
    type: String,
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

