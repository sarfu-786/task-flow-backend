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
    enum: ['Lead', 'Opportunity', 'User', 'SLA', 'Disposition', 'Export', 'System'],
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
      'SLA_TIER1_BREACH',
      'SLA_TIER2_ESCALATION',
      'SLA_TIER3_UNASSIGNMENT',
      'LEAD_CLAIMED',
      'EXPORT_DOWNLOAD',
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

module.exports = mongoose.model('AuditLog', auditLogSchema);
