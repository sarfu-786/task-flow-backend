const mongoose = require('mongoose');

const opportunitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Opportunity name is required'],
    trim: true,
  },
  company: {
    type: String,
    trim: true,
    default: '',
  },
  relatedLead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    default: null,
  },
  relatedLeadName: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    default: 0,
    min: [0, 'Amount cannot be negative'],
  },
  stage: {
    type: String,
    enum: ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'],
    default: 'Qualification',
  },
  probability: {
    type: Number,
    min: [0, 'Probability cannot be less than 0'],
    max: [100, 'Probability cannot be more than 100'],
    default: 20,
  },
  expectedCloseDate: {
    type: Date,
    default: null,
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium',
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
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
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

opportunitySchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Opportunity', opportunitySchema);
