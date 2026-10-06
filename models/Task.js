const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  taskType: {
    type: String,
    required: [true, 'Task type is required'],
    enum: {
      values: [
        'internet work',
        'documentation',
        'social media',
        'backend work',
        'sells',
        'sales',
        'client communication',
        'data entry',
        'research & analysis',
        'research and analysis',
        'follow-up',
        'follow up',
        'testing & quality check',
        'testing and quality check',
        'administrative work',
        'technical support'
      ],
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
  assignedById: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  completionRemark: {
    type: String,
    trim: true,
    default: '',
  },
  completedAt: {
    type: Date,
  },
  attachments: [
    {
      name: { type: String, required: true },
      url: { type: String, required: true },
      type: { type: String, default: 'application/octet-stream' },
      size: { type: Number, default: 0 },
      uploadedAt: { type: Date, default: Date.now },
      uploadedBy: { type: String, default: '' },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  }
});

taskSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

taskSchema.index({ user: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ assignedById: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ priority: 1 });
taskSchema.index({ expectedDate: 1 });
taskSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Task', taskSchema);
