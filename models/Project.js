const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  dueDate: {
    type: Date,
    default: null,
  },
  isCompleted: {
    type: Boolean,
    default: false,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  weight: {
    type: Number,
    default: 1, // weight in progress calculation
  },
});

const projectSchema = new mongoose.Schema({
  projectCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    required: [true, 'Please provide the project name'],
    trim: true,
  },
  clientName: {
    type: String,
    required: [true, 'Please provide the client name'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  category: {
    type: String,
    enum: [
      'Enterprise Software',
      'Cloud Migration',
      'Web Application',
      'Mobile Development',
      'System Integration',
      'Infrastructure & DevOps',
      'Consulting & Audit',
      'Custom Delivery',
    ],
    default: 'Web Application',
  },
  status: {
    type: String,
    enum: ['Planning', 'In Progress', 'Under Review', 'Completed', 'On Hold'],
    default: 'Planning',
  },
  priority: {
    type: String,
    enum: ['Urgent', 'High', 'Medium', 'Low'],
    default: 'Medium',
  },
  budget: {
    type: Number,
    default: 0,
  },
  currency: {
    type: String,
    enum: ['USD', 'INR'],
    default: 'USD',
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  targetDate: {
    type: Date,
    required: [true, 'Please provide target completion date'],
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  managerName: {
    type: String,
    default: 'Unassigned',
    trim: true,
  },
  teamMembers: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      name: String,
      role: String,
      email: String,
    },
  ],
  milestones: [milestoneSchema],
  deliverableTasks: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
    },
  ],
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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Auto-calculate progress if milestones exist
projectSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  if (this.milestones && this.milestones.length > 0) {
    const totalMilestones = this.milestones.length;
    const completedCount = this.milestones.filter((m) => m.isCompleted).length;
    this.progress = Math.round((completedCount / totalMilestones) * 100);
    if (this.progress === 100 && this.status !== 'Completed') {
      this.status = 'Completed';
    }
  }
  next();
});

module.exports = mongoose.model('Project', projectSchema);
