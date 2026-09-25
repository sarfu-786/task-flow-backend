const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  customerName: {
    type: String,
    required: [true, 'Please provide the customer name'],
    trim: true,
  },
  customerEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  customerPhone: {
    type: String,
    trim: true,
    default: '',
  },
  organization: {
    type: String,
    trim: true,
    default: '',
  },
  subject: {
    type: String,
    required: [true, 'Please provide the complaint subject'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Please provide a detailed description'],
    trim: true,
  },
  category: {
    type: String,
    enum: [
      'Product Defect',
      'Service Delay',
      'Billing Query',
      'Technical Glitch',
      'Hardware Fault',
      'Account Access',
      'Quality Assurance',
      'General Support',
    ],
    default: 'Technical Glitch',
  },
  priority: {
    type: String,
    enum: ['Urgent', 'High', 'Medium', 'Low'],
    default: 'Medium',
  },
  status: {
    type: String,
    enum: [
      'Logged',
      'Under Investigation',
      'In Progress',
      'Awaiting Customer',
      'Resolved',
      'Closed',
    ],
    default: 'Logged',
  },
  slaHours: {
    type: Number,
    default: 24, // Default 24 hours SLA
  },
  slaDeadline: {
    type: Date,
    required: true,
  },
  slaStatus: {
    type: String,
    enum: ['On Track', 'At Risk', 'Breached', 'Met'],
    default: 'On Track',
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  assignedToName: {
    type: String,
    default: 'Unassigned',
    trim: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdByName: {
    type: String,
    default: '',
    trim: true,
  },
  resolutionNotes: {
    type: String,
    default: '',
    trim: true,
  },
  rootCause: {
    type: String,
    default: '',
    trim: true,
  },
  csatRating: {
    type: Number,
    min: 1,
    max: 5,
    default: null,
  },
  resolvedAt: {
    type: Date,
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

// Calculate and update SLA status before saving
complaintSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  const now = new Date();

  if (['Resolved', 'Closed'].includes(this.status)) {
    if (this.resolvedAt && this.slaDeadline) {
      this.slaStatus = this.resolvedAt <= this.slaDeadline ? 'Met' : 'Breached';
    } else {
      this.slaStatus = 'Met';
    }
  } else if (this.slaDeadline) {
    const timeLeftMs = new Date(this.slaDeadline).getTime() - now.getTime();
    const hoursLeft = timeLeftMs / (1000 * 60 * 60);

    if (hoursLeft < 0) {
      this.slaStatus = 'Breached';
    } else if (hoursLeft <= 4) {
      this.slaStatus = 'At Risk';
    } else {
      this.slaStatus = 'On Track';
    }
  }

  next();
});

module.exports = mongoose.model('Complaint', complaintSchema);
