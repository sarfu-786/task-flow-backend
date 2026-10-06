const mongoose = require('mongoose');
const crypto = require('crypto');

const opportunitySchema = new mongoose.Schema({
  // Global Unique Immutable Identifier (UUIDv4)
  opportunity_id: {
    type: String,
    unique: true,
    index: true,
    default: () => 'opp_' + crypto.randomUUID(),
  },

  // Professional Human-Readable Opportunity ID (e.g. OP-001)
  opportunityId: {
    type: String,
    index: true,
    default: function () {
      return this.opportunity_id || 'OP-' + Math.floor(1000 + Math.random() * 9000);
    },
  },

  name: {
    type: String,
    required: [true, 'Opportunity name is required'],
    trim: true,
  },
  opportunityName: {
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

  // Contact details retained from converted Lead
  contactPerson: {
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
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  leadSource: {
    type: String,
    trim: true,
    default: 'Website',
  },

  // Bidirectional link to Source Lead
  leadId: {
    type: String,
    default: '',
    index: true,
  },
  originalLeadId: {
    type: String,
    default: '',
    index: true,
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
  sourceLeadName: {
    type: String,
    trim: true,
    default: function () {
      return this.relatedLeadName || '';
    },
  },

  // Valuation & Pipeline Stage:
  // New Opportunity -> Contacted -> Requirement Understanding -> Proposal / Quotation -> Negotiation -> Won / Lost
  amount: {
    type: Number,
    default: 0,
    min: [0, 'Amount cannot be negative'],
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
  stage: {
    type: String,
    enum: [
      'New Opportunity',
      'Contacted',
      'Requirement Understanding',
      'Proposal / Quotation',
      'Proposal/Quotation',
      'Negotiation',
      'Won',
      'Lost',
      // Legacy compatibility:
      'Qualification',
      'Needs Analysis',
      'Proposal',
      'Closed Won',
      'Closed Lost',
    ],
    default: 'New Opportunity',
    index: true,
  },
  opportunity_stage: {
    type: String,
    default: 'NEW_OPPORTUNITY',
  },
  lostReason: {
    type: String,
    enum: [
      'Price too high',
      'Competitor selected',
      'Budget unavailable',
      'Requirement changed',
      'Not interested',
      'Other',
      '',
    ],
    default: '',
  },
  lostReasonDetails: {
    type: String,
    trim: true,
    default: '',
  },
  wonAt: {
    type: Date,
    default: null,
  },
  lostAt: {
    type: Date,
    default: null,
  },
  probability: {
    type: Number,
    min: [0, 'Probability cannot be less than 0'],
    max: [100, 'Probability cannot be more than 100'],
    default: 10,
  },
  expectedCloseDate: {
    type: Date,
    default: null,
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium',
  },

  // Ownership & Assignment
  assignedTo: {
    type: String,
    default: 'Current User',
  },
  assignedToId: {
    type: String,
    default: '',
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

  // Channel Attribution & Aging
  campaign_source: {
    type: String,
    trim: true,
    default: 'Website Direct',
  },
  cost_per_lead: {
    type: Number,
    default: 0,
  },
  stage_entered_at: {
    type: Date,
    default: Date.now,
  },
  days_in_stage: {
    type: Number,
    default: 0,
  },
  last_activity_at: {
    type: Date,
    default: Date.now,
  },
  is_at_risk: {
    type: Boolean,
    default: false,
  },

  // Activity Log history
  activity_history: [
    {
      type: { type: String, default: 'STAGE_UPDATE' },
      note: { type: String, default: '' },
      agent: { type: String, default: '' },
      timestamp: { type: Date, default: Date.now },
    },
  ],

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

opportunitySchema.pre('save', function (next) {
  this.updatedAt = Date.now();

  if (!this.opportunity_id) {
    this.opportunity_id = 'opp_' + crypto.randomUUID();
  }
  if (!this.opportunityId) {
    this.opportunityId = 'OP-' + Math.floor(1000 + Math.random() * 9000);
  }

  // Synchronize name and opportunityName
  if (this.name && !this.opportunityName) {
    this.opportunityName = this.name;
  } else if (this.opportunityName && !this.name) {
    this.name = this.opportunityName;
  }

  // Synchronize amount, dealValue, and pipeline_value
  const val = this.dealValue || this.amount || this.pipeline_value || 0;
  this.dealValue = val;
  this.amount = val;
  this.pipeline_value = val;

  // Synchronize relatedLeadName & sourceLeadName
  if (this.relatedLeadName && !this.sourceLeadName) {
    this.sourceLeadName = this.relatedLeadName;
  } else if (this.sourceLeadName && !this.relatedLeadName) {
    this.relatedLeadName = this.sourceLeadName;
  }

  // Synchronize leadId and originalLeadId
  if (this.leadId && !this.originalLeadId) {
    this.originalLeadId = this.leadId;
  } else if (this.originalLeadId && !this.leadId) {
    this.leadId = this.originalLeadId;
  }

  // Synchronize leadSource and campaign_source
  if (this.leadSource && !this.campaign_source) {
    this.campaign_source = this.leadSource;
  } else if (this.campaign_source && !this.leadSource) {
    this.leadSource = this.campaign_source;
  }

  // Synchronize remarks and notes
  if (this.remarks && !this.notes) {
    this.notes = this.remarks;
  } else if (this.notes && !this.remarks) {
    this.remarks = this.notes;
  }

  // Synchronize opportunity_stage and stage
  if (this.stage) {
    this.opportunity_stage = this.stage.toUpperCase().replace(/[\s\/]+/g, '_');
  }

  // Handle stage timestamps (Won / Lost)
  if (this.stage === 'Won' || this.stage === 'Closed Won') {
    if (!this.wonAt) this.wonAt = new Date();
    this.lostAt = null;
    this.lostReason = '';
    this.lostReasonDetails = '';
  } else if (this.stage === 'Lost' || this.stage === 'Closed Lost') {
    if (!this.lostAt) this.lostAt = new Date();
    this.wonAt = null;
  } else {
    // Active stage
    this.wonAt = null;
    this.lostAt = null;
  }

  // Calculate days in stage and risk status (>14 days without activity)
  if (this.stage_entered_at) {
    const diffMs = Date.now() - new Date(this.stage_entered_at).getTime();
    this.days_in_stage = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  if (this.last_activity_at) {
    const diffActivity = Date.now() - new Date(this.last_activity_at).getTime();
    const daysInactive = Math.floor(diffActivity / (1000 * 60 * 60 * 24));
    this.is_at_risk = daysInactive > 14 && !['Closed Won', 'Closed Lost', 'Won', 'Lost'].includes(this.stage);
  }

  next();
});

module.exports = mongoose.model('Opportunity', opportunitySchema);
