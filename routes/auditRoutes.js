const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// @route   GET /api/audit-logs
// @desc    Query immutable audit trail logs with filtering by action, entity_type, operator, and entity_id
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { action, entity_type, entity_id, search, limit = 50 } = req.query;

    let logs = [];

    if (fallbackStore.isFallback) {
      logs = [...(fallbackStore.auditLogs || [])];

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
// @desc    Get complete audit timeline for a specific entity (e.g. Lead or Opportunity)
// @access  Private
router.get('/:entityType/:entityId', protect, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

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
