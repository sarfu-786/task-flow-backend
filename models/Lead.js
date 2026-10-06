const mongoose = require('mongoose');
const crypto = require('crypto');

const leadSchema = new mongoose.Schema({
  // Global Unique Immutable Identifier
  lead_id: {
    type: String,
    unique: true,
    index: true,
    default: () => 'lead_' + crypto.randomUUID(),
  },

  // Professional Human-Readable Lead ID (e.g. LD-001, LD-002)
  leadId: {
    type: String,
    index: true,
    default: function () {
      return this.lead_id || 'LD-' + Math.floor(1000 + Math.random() * 9000);
    },
  },

  // Primary Contact & Organization Details
  name: {
    type: String,
    required: [true, 'Lead name is required'],
    trim: true,
  },
  contactPerson: {
    type: String,
    trim: true,
    default: function () {
      return this.name || '';
    },
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
  mobileNumber: {
    type: String,
    trim: true,
    default: function () {
      return this.phone || '';
    },
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  requirement: {
    type: String,
    trim: true,
    default: '',
  },

  // Channel Attribution & Source
  source: {
    type: String,
    trim: true,
    default: 'Website',
  },
  campaign_source: {
    type: String,
    trim: true,
    default: 'Website Direct',
  },
  cost_per_lead: {
    type: Number,
    default: 0,
    min: 0,
  },
  engagement_score: {
    type: Number,
    min: 0,
    max: 100,
    default: 50,
  },
  leadScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 50,
    index: true,
  },
  leadTemperature: {
    type: String,
    enum: ['Hot', 'Warm', 'Cold'],
    default: 'Warm',
    index: true,
  },

  // Core Status: New -> Contacted -> Follow-Up -> Qualified -> Interested -> Converted | Not Interested | Invalid
  status: {
    type: String,
    default: 'New',
    index: true,
  },
  lead_status: {
    type: String,
    default: 'NEW',
  },

  // Priority & Valuation
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium',
    index: true,
  },
  estimatedValue: {
    type: Number,
    default: 0,
    min: 0,
  },
  dealValue: {
    type: Number,
    default: 0,
    min: 0,
  },
  pipeline_value: {
    type: Number,
    default: 0,
    min: 0,
  },
  currency: {
    type: String,
    enum: ['USD', 'INR'],
    default: 'INR',
  },

  // Assignment: Sales User & Manager
  assignedTo: {
    type: String,
    default: 'Current User',
    index: true,
  },
  assignedToId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  assignedSalesUser: {
    type: String,
    default: function () {
      return this.assignedTo || '';
    },
  },
  assignedManager: {
    type: String,
    default: '',
  },
  assignedManagerName: {
    type: String,
    default: '',
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

  // Follow-Up & Contact Dates
  lastContactDate: {
    type: Date,
    default: null,
  },
  last_contacted_at: {
    type: Date,
    default: null,
  },
  nextFollowUpDate: {
    type: Date,
    default: null,
    index: true,
  },
  nextFollowUpTime: {
    type: String,
    default: '',
  },
  next_followup_at: {
    type: Date,
    default: null,
  },
  remarks: {
    type: String,
    trim: true,
    default: '',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },

  // Communication History / Call Logs
  callLogs: [
    {
      activityId: { type: String, default: () => 'ACT-' + Math.floor(1000 + Math.random() * 9000) },
      leadId: { type: String, default: '' },
      salesUser: { type: String, default: '' },
      salesUserId: { type: String, default: '' },
      date: { type: String, default: () => new Date().toISOString().split('T')[0] },
      time: { type: String, default: () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) },
      callType: { type: String, enum: ['Incoming', 'Outgoing'], default: 'Outgoing' },
      callStatus: {
        type: String,
        enum: [
          'No Answer',
          'Call Received',
          'Busy',
          'Switched Off',
          'Number Not Reachable',
          'Call Back Requested',
          'Connected Successfully',
        ],
        default: 'Connected Successfully',
      },
      duration: { type: String, default: '' },
      callOutcome: {
        type: String,
        enum: [
          'Interested',
          'Not Interested',
          'Need More Information',
          'Call Later',
          'Meeting Requested',
          'Proposal Requested',
          'Qualified',
          'Not Qualified',
          'No Response',
        ],
        default: 'Interested',
      },
      leadResponse: { type: String, default: '' },
      remarks: { type: String, default: '' },
      nextAction: { type: String, default: '' },
      nextFollowUpDate: { type: String, default: '' },
      nextFollowUpTime: { type: String, default: '' },
      timestamp: { type: Date, default: Date.now },
    },
  ],

  // Follow-Up Records
  followups: [
    {
      followUpId: { type: String, default: () => 'FLW-' + Math.floor(1000 + Math.random() * 9000) },
      followUpDate: { type: Date, default: null },
      followUpTime: { type: String, default: '' },
      reason: { type: String, default: '' },
      assignedTo: { type: String, default: '' },
      assignedToId: { type: String, default: '' },
      remarks: { type: String, default: '' },
      status: {
        type: String,
        enum: ['Pending', 'Completed', 'Rescheduled', 'Cancelled', 'No Response'],
        default: 'Pending',
      },
      completedAt: { type: Date, default: null },
      completedBy: { type: String, default: '' },
      createdAt: { type: Date, default: Date.now },
    },
  ],

  // Activity Timeline Journey
  timeline: [
    {
      eventId: { type: String, default: () => 'EVT-' + Math.floor(1000 + Math.random() * 9000) },
      eventType: {
        type: String,
        enum: [
          'LEAD_CREATED',
          'CALL_LOGGED',
          'FOLLOWUP_SCHEDULED',
          'FOLLOWUP_UPDATED',
          'STATUS_CHANGED',
          'CONVERTED_TO_OPPORTUNITY',
          'DISPOSITION_LOGGED',
          'LEAD_UPDATED',
        ],
        default: 'LEAD_CREATED',
      },
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      author: { type: String, default: 'System' },
      authorId: { type: String, default: '' },
      metadata: { type: Object, default: {} },
      timestamp: { type: Date, default: Date.now },
    },
  ],

  // Opportunity Conversion & Linkage
  opportunityId: {
    type: String,
    default: null,
  },
  convertedOpportunityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Opportunity',
    default: null,
  },
  convertedAt: {
    type: Date,
    default: null,
  },
  convertedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  convertedByName: {
    type: String,
    default: '',
  },

  // Legacy & SLA Daemons compatibility
  disposition_code: {
    type: String,
    enum: ['NO_ANSWER', 'BUSY', 'CALL_BACK', 'NOT_INTERESTED', 'QUALIFIED_OPPORTUNITY', 'NONE'],
    default: 'NONE',
  },
  last_disposition_at: {
    type: Date,
    default: null,
  },
  disposition_history: [
    {
      disposition_code: { type: String },
      notes: { type: String, default: '' },
      agent_name: { type: String, default: '' },
      agent_id: { type: String, default: '' },
      duration_seconds: { type: Number, default: 0 },
      next_followup_at: { type: Date, default: null },
      retry_count: { type: Number, default: 0 },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  sla_tier: {
    type: Number,
    enum: [0, 1, 2, 3],
    default: 0,
  },
  sla_breached_at: {
    type: Date,
    default: null,
  },
  sla_escalated_to_lead: {
    type: Boolean,
    default: false,
  },
  sla_unassigned: {
    type: Boolean,
    default: false,
  },
  is_high_priority_pool: {
    type: Boolean,
    default: false,
  },
  stage_entered_at: {
    type: Date,
    default: Date.now,
  },
  days_in_stage: {
    type: Number,
    default: 0,
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Pre-save synchronization hook
leadSchema.pre('save', function (next) {
  this.updatedAt = Date.now();

  // Auto-generate lead_id and human readable leadId
  if (!this.lead_id) {
    this.lead_id = 'lead_' + crypto.randomUUID();
  }
  if (!this.leadId) {
    this.leadId = 'LD-' + Math.floor(1000 + Math.random() * 9000);
  }

  // Synchronize contactPerson & name
  if (this.name && !this.contactPerson) {
    this.contactPerson = this.name;
  } else if (this.contactPerson && !this.name) {
    this.name = this.contactPerson;
  }

  // Synchronize phone & mobileNumber
  if (this.phone && !this.mobileNumber) {
    this.mobileNumber = this.phone;
  } else if (this.mobileNumber && !this.phone) {
    this.phone = this.mobileNumber;
  }

  // Synchronize next_followup_at and nextFollowUpDate
  if (this.next_followup_at && !this.nextFollowUpDate) {
    this.nextFollowUpDate = this.next_followup_at;
  } else if (this.nextFollowUpDate && !this.next_followup_at) {
    this.next_followup_at = this.nextFollowUpDate;
  }

  // Synchronize lastContactDate and last_contacted_at
  if (this.lastContactDate && !this.last_contacted_at) {
    this.last_contacted_at = this.lastContactDate;
  } else if (this.last_contacted_at && !this.lastContactDate) {
    this.lastContactDate = this.last_contacted_at;
  }

  // Synchronize pipeline_value, dealValue, and estimatedValue
  const val = this.estimatedValue || this.dealValue || this.pipeline_value || 0;
  this.estimatedValue = val;
  this.dealValue = val;
  this.pipeline_value = val;

  // Synchronize assignedTo and assignedSalesUser
  if (this.assignedTo && !this.assignedSalesUser) {
    this.assignedSalesUser = this.assignedTo;
  } else if (this.assignedSalesUser && !this.assignedTo) {
    this.assignedTo = this.assignedSalesUser;
  }

  // Synchronize remarks & notes
  if (this.remarks && !this.notes) {
    this.notes = this.remarks;
  } else if (this.notes && !this.remarks) {
    this.remarks = this.notes;
  }

  // Synchronize lead_status and status
  if (this.status) {
    const s = this.status.toUpperCase();
    if (['NEW', 'LOST', 'CONVERTED'].includes(s)) {
      this.lead_status = s;
    } else if (['CONTACTED', 'FOLLOW-UP', 'FOLLOW_UP', 'QUALIFIED', 'INTERESTED', 'PROPOSAL SENT', 'IN PROGRESS', 'IN_PROGRESS'].includes(s)) {
      this.lead_status = 'IN_PROGRESS';
    }
  }

  // Calculate days in current stage
  if (this.stage_entered_at) {
    const diffMs = Date.now() - new Date(this.stage_entered_at).getTime();
    this.days_in_stage = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  // Calculate Lead Score & Lead Temperature
  try {
    const { calculateLeadScore } = require('../services/leadScoringService');
    const scoring = calculateLeadScore(this);
    this.leadScore = scoring.score;
    this.leadTemperature = scoring.temperature;
  } catch (scoreErr) {
    // Graceful fallback
    if (this.leadScore === undefined) this.leadScore = 50;
    if (!this.leadTemperature) this.leadTemperature = 'Warm';
  }

  next();
});

module.exports = mongoose.model('Lead', leadSchema);
