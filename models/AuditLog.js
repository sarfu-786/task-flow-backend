const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  log_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  entity_type: {
    type: String,
    enum: ['Lead', 'Opportunity', 'Complaint', 'User', 'SLA', 'Disposition', 'Export', 'System', 'Project', 'Task'],
    required: true,
    index: true,
  },
  entity_id: {
    type: String,
    required: true,
    index: true,
  },
  action: {
    type: String,
    enum: [
      'CREATE',
      'UPDATE',
      'STATUS_CHANGE',
      'DISPOSITION_LOGGED',
      'CONVERT',
      'DELETE',
      'ASSIGNMENT',
      'ESCALATE',
      'RESOLVE',
      'CLOSE',
      'REOPEN',
      'ACTIVITY_LOGGED',
      'INVESTIGATION_UPDATE',
      'SLA_TIER1_BREACH',
      'SLA_TIER2_ESCALATION',
      'SLA_TIER3_UNASSIGNMENT',
      'LEAD_CLAIMED',
      'EXPORT_DOWNLOAD',
      'IMPORT_EXCEL',
      'EXPORT_EXCEL',
    ],
    required: true,
    index: true,
  },
  operator_id: {
    type: String,
    default: 'SYSTEM',
  },
  operator_name: {
    type: String,
    default: 'System Daemon',
  },
  operator_role: {
    type: String,
    default: 'System',
  },
  prior_state: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  updated_state: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  delta: {
    type: String,
    default: '',
  },
  ip_address: {
    type: String,
    default: '127.0.0.1',
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Production Compound Indexes
auditLogSchema.index({ entity_type: 1, entity_id: 1, timestamp: -1 });
auditLogSchema.index({ operator_id: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
