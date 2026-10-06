const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');
const { getUserScopeContext, isLeadAccessible } = require('../services/hierarchyService');

const canUserAccessLead = (user, lead, allUsers = []) => {
  if (!user || !lead) return false;
  const scope = getUserScopeContext(user, allUsers);
  return isLeadAccessible(scope, lead);
};

// @route   GET /api/audit-logs
// @desc    Query immutable audit trail logs with filtering by action, entity_type, operator, and entity_id with hierarchy check
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { action, entity_type, entity_id, search, limit = 50 } = req.query;
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';

    let logs = [];

    if (fallbackStore.isFallback) {
      logs = [...(fallbackStore.auditLogs || [])];
      const allUsers = fallbackStore.users || [];
      const allLeads = fallbackStore.leads || [];

      if (entity_type && entity_type !== 'all') {
        logs = logs.filter((l) => l.entity_type === entity_type);
      }
      if (action && action !== 'all') {
        logs = logs.filter((l) => l.action === action);
      }
      if (entity_id) {
        logs = logs.filter((l) => String(l.entity_id) === String(entity_id));
      }
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        logs = logs.filter(
          (l) =>
            (l.delta && l.delta.toLowerCase().includes(q)) ||
            (l.operator_name && l.operator_name.toLowerCase().includes(q)) ||
            (l.entity_id && l.entity_id.toLowerCase().includes(q)) ||
            (l.action && l.action.toLowerCase().includes(q))
        );
      }

      // Hierarchy permission filter for Leads: Non-superadmins only see audit logs of leads they can access
      if (!isSuperAdmin) {
        logs = logs.filter((l) => {
          if (l.entity_type !== 'Lead') return true;
          const matchedLead = allLeads.find(
            (ld) =>
              (ld._id && String(ld._id) === String(l.entity_id)) ||
              (ld.leadId && ld.leadId === l.entity_id) ||
              (ld.lead_id && ld.lead_id === l.entity_id)
          );
          if (!matchedLead) return true; // generic/deleted log
          return canUserAccessLead(req.user, matchedLead, allUsers);
        });
      }

      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      logs = logs.slice(0, Number(limit) || 50);

      return res.json({
        success: true,
        count: logs.length,
        logs,
      });
    } else {
      const query = {};
      if (entity_type && entity_type !== 'all') query.entity_type = entity_type;
      if (action && action !== 'all') query.action = action;
      if (entity_id) query.entity_id = entity_id;
      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), 'i');
        query.$or = [{ delta: regex }, { operator_name: regex }, { entity_id: regex }];
      }

      logs = await AuditLog.find(query).sort({ timestamp: -1 }).limit(Number(limit) || 50).lean();

      if (!isSuperAdmin) {
        const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
        const leadEntityIds = logs.filter((l) => l.entity_type === 'Lead').map((l) => l.entity_id);
        if (leadEntityIds.length > 0) {
          const matchingLeads = await Lead.find({
            $or: [
              { _id: { $in: leadEntityIds.filter((id) => /^[0-9a-fA-F]{24}$/.test(id)) } },
              { leadId: { $in: leadEntityIds } },
              { lead_id: { $in: leadEntityIds } },
            ],
          }).lean();

          logs = logs.filter((l) => {
            if (l.entity_type !== 'Lead') return true;
            const matchedLead = matchingLeads.find(
              (ld) =>
                String(ld._id) === String(l.entity_id) ||
                ld.leadId === l.entity_id ||
                ld.lead_id === l.entity_id
            );
            if (!matchedLead) return true;
            return canUserAccessLead(req.user, matchedLead, allDbUsers);
          });
        }
      }

      return res.json({
        success: true,
        count: logs.length,
        logs,
      });
    }
  } catch (error) {
    console.error('Audit logs query error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs', error: error.message });
  }
});

// @route   GET /api/audit-logs/:entityType/:entityId
// @desc    Get complete audit timeline for a specific entity with hierarchy validation
// @access  Private
router.get('/:entityType/:entityId', protect, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';

    // Hierarchy validation for Lead entity
    if (entityType.toLowerCase() === 'lead' && !isSuperAdmin) {
      let targetLead = null;
      let allUsers = [];

      if (fallbackStore.isFallback) {
        targetLead = (fallbackStore.leads || []).find(
          (l) => l._id?.toString() === entityId || l.leadId === entityId || l.lead_id === entityId
        );
        allUsers = fallbackStore.users || [];
      } else {
        if (/^[0-9a-fA-F]{24}$/.test(entityId)) {
          targetLead = await Lead.findById(entityId).lean();
        }
        if (!targetLead) {
          targetLead = await Lead.findOne({ $or: [{ leadId: entityId }, { lead_id: entityId }] }).lean();
        }
        allUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      }

      if (targetLead && !canUserAccessLead(req.user, targetLead, allUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to view audit history for this lead',
        });
      }
    }

    let logs = [];
    if (fallbackStore.isFallback) {
      logs = (fallbackStore.auditLogs || []).filter(
        (l) => l.entity_type?.toLowerCase() === entityType.toLowerCase() && String(l.entity_id) === String(entityId)
      );
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } else {
      logs = await AuditLog.find({
        entity_type: new RegExp('^' + entityType + '$', 'i'),
        entity_id: entityId,
      }).sort({ timestamp: -1 }).lean();
    }

    res.json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch entity timeline', error: err.message });
  }
});

module.exports = router;
