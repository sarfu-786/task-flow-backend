const crypto = require('crypto');
const AuditLog = require('../models/AuditLog');
const { fallbackStore } = require('../config/db');

/**
 * Creates an immutable audit log entry in MongoDB or fallbackStore
 * @param {Object} params
 * @param {string} params.entity_type - 'Lead' | 'Opportunity' | 'User' | 'SLA' | 'Disposition' | 'Export'
 * @param {string} params.entity_id - Identifier of the entity
 * @param {string} params.action - Action performed
 * @param {Object} [params.operator] - User performing the action (or null for System)
 * @param {Object} [params.prior_state] - State before mutation
 * @param {Object} [params.updated_state] - State after mutation
 * @param {string} [params.delta] - Short summary of changes
 * @param {Object} [params.req] - Express request object for IP and headers
 * @returns {Promise<Object>} The created log entry
 */
const logAuditAction = async ({
  entity_type,
  entity_id,
  action,
  operator = null,
  prior_state = null,
  updated_state = null,
  delta = '',
  req = null,
}) => {
  try {
    const log_id = 'aud_' + crypto.randomBytes(8).toString('hex');
    const operator_id = operator?._id ? operator._id.toString() : operator?.id ? operator.id.toString() : 'SYSTEM';
    const operator_name = operator?.name || operator?.username || 'System Daemon';
    const operator_role = operator?.role || 'System';

    let ip_address = '127.0.0.1';
    if (req) {
      ip_address = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    }

    const logEntry = {
      log_id,
      entity_type,
      entity_id: String(entity_id),
      action,
      operator_id,
      operator_name,
      operator_role,
      prior_state: prior_state ? JSON.parse(JSON.stringify(prior_state)) : null,
      updated_state: updated_state ? JSON.parse(JSON.stringify(updated_state)) : null,
      delta: delta || `${action} on ${entity_type} (${entity_id})`,
      ip_address: String(ip_address),
      timestamp: new Date(),
    };

    if (fallbackStore.isFallback) {
      if (!fallbackStore.auditLogs) fallbackStore.auditLogs = [];
      fallbackStore.auditLogs.unshift(logEntry);
      // Keep store size under 2,000 entries
      if (fallbackStore.auditLogs.length > 2000) {
        fallbackStore.auditLogs.length = 2000;
      }
      fallbackStore.saveToFile();
    } else {
      try {
        await AuditLog.create(logEntry);
      } catch (dbErr) {
        console.warn('[Audit Service] MongoDB write notice:', dbErr.message);
      }

      if (!fallbackStore.auditLogs) fallbackStore.auditLogs = [];
      fallbackStore.auditLogs.unshift(logEntry);
      if (fallbackStore.auditLogs.length > 2000) {
        fallbackStore.auditLogs.length = 2000;
      }
      fallbackStore.saveToFile();
    }

    return logEntry;
  } catch (error) {
    console.error('[Audit Service Error]', error.message);
    return null;
  }
};

module.exports = {
  logAuditAction,
};
