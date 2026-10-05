const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  activityId: { type: String, default: () => 'act_' + Math.random().toString(16).substring(2, 10) },
  type: {
    type: String,
    enum: ['Call', 'Email', 'Note', 'Task', 'Follow-up', 'Customer Communication', 'Status Change', 'Investigation', 'Escalation'],
    default: 'Note',
  },
  author: { type: String, default: '' },
  authorName: { type: String, default: '' },
  date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
  time: { type: String, default: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
  subject: { type: String, default: '' },
  content: { type: String, default: '' },
  outcome: { type: String, default: '' },
  nextAction: { type: String, default: '' },
  nextFollowUpDate: { type: String, default: '' },
  nextFollowUpTime: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
});

const assignmentHistorySchema = new mongoose.Schema({
  fromUser: { type: String, default: '' },
  fromUserName: { type: String, default: '' },
  toUser: { type: String, default: '' },
  toUserName: { type: String, default: '' },
  assignedBy: { type: String, default: '' },
  assignedByName: { type: String, default: '' },
  reason: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
});

const complaintSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  complaintId: {
    type: String,
    trim: true,
    default: '',
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
  account: {
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
    default: 'Technical Glitch',
    trim: true,
  },
  subCategory: {
    type: String,
    default: 'General',
    trim: true,
  },
  complaintType: {
    type: String,
    enum: ['Complaint', 'Bug', 'Service Request', 'Incident', 'Inquiry', 'Billing', 'Feedback'],
    default: 'Complaint',
  },
  productOrService: {
    type: String,
    default: 'CRM Platform',
    trim: true,
  },
  source: {
    type: String,
    enum: ['Web Portal', 'Email', 'Phone', 'Chat', 'In-Person', 'Mobile App', 'Social Media', 'Other'],
    default: 'Web Portal',
  },
  priority: {
    type: String,
    enum: ['Urgent', 'High', 'Medium', 'Low'],
    default: 'Medium',
  },
  severity: {
    type: String,
    enum: ['Critical', 'Major', 'Moderate', 'Minor'],
    default: 'Moderate',
  },
  status: {
    type: String,
    enum: [
      'Logged',
      'Under Investigation',
      'Assigned',
      'In Progress',
      'Awaiting Customer',
      'Escalated',
      'Resolved',
      'Closed',
      'Reopened',
      'Cancelled',
    ],
    default: 'Logged',
  },
  slaHours: {
    type: Number,
    default: 24, // Default 24 hours SLA
  },
  slaDeadline: {
    type: Date,
    default: function () {
      let hours = this.slaHours || 24;
      if (this.priority === 'Urgent') hours = 4;
      else if (this.priority === 'High') hours = 12;
      else if (this.priority === 'Low') hours = 48;
      return new Date(Date.now() + hours * 60 * 60 * 1000);
    },
  },
  firstResponseDeadline: {
    type: Date,
    default: function () {
      let hours = 4;
      if (this.priority === 'Urgent') hours = 1;
      else if (this.priority === 'High') hours = 2;
      else if (this.priority === 'Low') hours = 8;
      return new Date(Date.now() + hours * 60 * 60 * 1000);
    },
  },
  firstResponseAt: {
    type: Date,
    default: null,
  },
  firstResponseSlaStatus: {
    type: String,
    enum: ['On Track', 'Met', 'Breached', 'Pending'],
    default: 'Pending',
  },
  slaStatus: {
    type: String,
    enum: ['On Track', 'At Risk', 'Breached', 'Met', 'Paused'],
    default: 'On Track',
  },
  isPaused: {
    type: Boolean,
    default: false,
  },
  pausedAt: {
    type: Date,
    default: null,
  },
  totalPausedTimeMs: {
    type: Number,
    default: 0,
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
  team: {
    type: String,
    default: 'Customer Success',
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
  // Follow-up Tracking
  nextFollowUpDate: {
    type: Date,
    default: null,
  },
  nextFollowUpTime: {
    type: String,
    default: '',
    trim: true,
  },
  nextFollowUpPurpose: {
    type: String,
    default: '',
    trim: true,
  },
  // Investigation & Root Cause Analysis (CAPA)
  investigationNotes: {
    type: String,
    default: '',
    trim: true,
  },
  rootCause: {
    type: String,
    default: '',
    trim: true,
  },
  correctiveAction: {
    type: String,
    default: '',
    trim: true,
  },
  preventiveAction: {
    type: String,
    default: '',
    trim: true,
  },
  // Resolution & Closure
  resolutionSummary: {
    type: String,
    default: '',
    trim: true,
  },
  resolutionNotes: {
    type: String,
    default: '',
    trim: true,
  },
  resolutionCode: {
    type: String,
    default: '',
    trim: true,
  },
  closureReason: {
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
  csatFeedback: {
    type: String,
    default: '',
    trim: true,
  },
  // Reopen & Escalation Handling
  reopenCount: {
    type: Number,
    default: 0,
  },
  reopenReason: {
    type: String,
    default: '',
    trim: true,
  },
  reopenedAt: {
    type: Date,
    default: null,
  },
  isEscalated: {
    type: Boolean,
    default: false,
  },
  escalationReason: {
    type: String,
    default: '',
    trim: true,
  },
  escalatedTo: {
    type: String,
    default: '',
    trim: true,
  },
  escalatedAt: {
    type: Date,
    default: null,
  },
  // Relationships & Linking
  isDuplicate: {
    type: Boolean,
    default: false,
  },
  parentComplaintId: {
    type: String,
    default: '',
    trim: true,
  },
  linkedComplaints: {
    type: [String],
    default: [],
  },
  linkedCustomer: {
    type: String,
    default: '',
    trim: true,
  },
  linkedOpportunity: {
    type: String,
    default: '',
    trim: true,
  },
  linkedProject: {
    type: String,
    default: '',
    trim: true,
  },
  knowledgeBaseArticle: {
    articleId: { type: String, default: '' },
    title: { type: String, default: '' },
    url: { type: String, default: '' },
    helpful: { type: Boolean, default: true },
  },
  // Sub-document arrays
  activities: [activitySchema],
  assignmentHistory: [assignmentHistorySchema],
  auditHistory: [
    {
      action: String,
      performedBy: String,
      performedByName: String,
      role: String,
      delta: String,
      priorState: mongoose.Schema.Types.Mixed,
      newState: mongoose.Schema.Types.Mixed,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  resolvedAt: {
    type: Date,
    default: null,
  },
  closedAt: {
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

  if (!this.complaintId) {
    this.complaintId = this.ticketNumber;
  }

  if (['Resolved', 'Closed'].includes(this.status)) {
    if (this.resolvedAt && this.slaDeadline) {
      this.slaStatus = this.resolvedAt <= this.slaDeadline ? 'Met' : 'Breached';
    } else {
      this.slaStatus = 'Met';
    }
  } else if (this.status === 'Awaiting Customer' || this.isPaused) {
    this.slaStatus = 'Paused';
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
