const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Lead name is required'],
    trim: true,
  },
  company: {
    type: String,
    trim: true,
    default: '',
  },
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  source: {
    type: String,
    trim: true,
    default: 'Website',
  },
  status: {
    type: String,
    enum: ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Converted', 'Lost'],
    default: 'New',
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium',
  },
  dealValue: {
    type: Number,
    default: 0,
  },
  leadScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 50,
  },
  currency: {
    type: String,
    enum: ['USD', 'INR'],
    default: 'USD',
  },
  assignedTo: {
    type: String,
    default: 'Current User',
  },
  assignedById: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  assignedBy: {
    type: String,
    default: 'Manager (Admin)',
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  nextFollowUpDate: {
    type: Date,
    default: null,
  },
  convertedOpportunityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Opportunity',
    default: null,
  },
  convertedProjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null,
  },
  convertedAt: {
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

leadSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Lead', leadSchema);
