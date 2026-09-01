const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  taskType: {
    type: String,
    required: [true, 'Task type is required'],
    enum: {
      values: ['internet work', 'documentation', 'social media', 'backend work'],
      message: '{VALUE} is not a supported task type',
    },
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Task description is required'],
    trim: true,
  },
  expectedDate: {
    type: Date,
    required: [true, 'Expected completion date is required'],
  },
  remark: {
    type: String,
    trim: true,
    default: '',
  },
  status: {
    type: String,
    enum: ['To Do', 'In Progress', 'Completed'],
    default: 'To Do',
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium',
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  assignedTo: {
    type: String,
    default: 'Current User',
  },
  assignedBy: {
    type: String,
    default: 'Manager (Admin)',
  },
  completionRemark: {
    type: String,
    trim: true,
    default: '',
  },
  completedAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  }
});

// Update the updatedAt timestamp before saving
taskSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Task', taskSchema);
