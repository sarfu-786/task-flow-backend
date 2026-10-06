const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');
const { logAuditAction } = require('../services/auditService');
const { getUserScopeContext, isLeadAccessible } = require('../services/hierarchyService');
const { calculateLeadScore, enrichLeadWithScoringAndFollowUp } = require('../services/leadScoringService');

const canUserAccessLead = (user, lead, allUsers = []) => {
  if (!user || !lead) return false;
  const scope = getUserScopeContext(user, allUsers);
  return isLeadAccessible(scope, lead);
};

// @route   PUT /api/followups/:id
// @desc    Update a follow-up across leads with hierarchy permission and audit log
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, followUpDate, followUpTime } = req.body;
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      let targetLead = null;
      let targetFollowup = null;

      for (const lead of fallbackStore.leads || []) {
        const found = (lead.followups || []).find((f) => f.followUpId === id || f._id?.toString() === id);
        if (found) {
          targetLead = lead;
          targetFollowup = found;
          break;
        }
      }

      if (!targetLead || !targetFollowup) {
        return res.status(404).json({ success: false, message: 'Follow-up record not found' });
      }

      const allUsers = fallbackStore.users || [];
      if (!canUserAccessLead(req.user, targetLead, allUsers)) {
        return res.status(403).json({ success: false, message: 'Forbidden: You do not have permission to update this follow-up' });
      }

      const priorStatus = targetFollowup.status;
      if (status) targetFollowup.status = status;
      if (remarks !== undefined) targetFollowup.remarks = remarks;
      if (followUpDate) targetFollowup.followUpDate = new Date(followUpDate);
      if (followUpTime) targetFollowup.followUpTime = followUpTime;

      if (status === 'Completed') {
        targetFollowup.completedAt = new Date();
        targetFollowup.completedBy = req.user?.name || 'User';

        if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
        targetLead.timeline.push({
          eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
          eventType: 'FOLLOWUP_UPDATED',
          title: 'Follow-Up Completed',
          description: `Follow-up (${targetFollowup.reason || 'Callback'}) completed by ${req.user?.name || 'User'}.`,
          author: req.user?.name || 'User',
          timestamp: new Date(),
        });
      }

      // Recalculate lead scoring
      const scoring = calculateLeadScore(targetLead);
      targetLead.leadScore = scoring.score;
      targetLead.leadTemperature = scoring.temperature;
      targetLead.updatedAt = new Date();
      fallbackStore.saveToFile();

      // Audit Log
      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead.leadId || targetLead._id,
        action: status === 'Completed' ? 'FOLLOWUP_COMPLETED' : 'FOLLOWUP_UPDATED',
        operator: req.user,
        prior_state: { status: priorStatus, followUpId: id },
        updated_state: { status: targetFollowup.status, remarks: targetFollowup.remarks, followUpId: id },
        delta: `Follow-up ${id} ${status === 'Completed' ? 'completed' : 'updated'} by ${req.user?.name || 'User'}`,
        req,
      });

      const enrichedLead = enrichLeadWithScoringAndFollowUp(targetLead);
      if (io) io.emit('leads:updated', { lead: enrichedLead, action: 'followup_updated' });

      return res.json({
        success: true,
        message: 'Follow-up updated successfully',
        followup: targetFollowup,
        lead: enrichedLead,
      });
    } else {
      const targetLead = await Lead.findOne({
        $or: [{ 'followups.followUpId': id }, { 'followups._id': id }],
      });

      if (!targetLead) {
        return res.status(404).json({ success: false, message: 'Follow-up record not found' });
      }

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, targetLead, allDbUsers)) {
        return res.status(403).json({ success: false, message: 'Forbidden: You do not have permission to update this follow-up' });
      }

      const targetFollowup = targetLead.followups.find((f) => f.followUpId === id || f._id?.toString() === id);
      if (!targetFollowup) {
        return res.status(404).json({ success: false, message: 'Follow-up record not found' });
      }

      const priorStatus = targetFollowup.status;
      if (status) targetFollowup.status = status;
      if (remarks !== undefined) targetFollowup.remarks = remarks;
      if (followUpDate) targetFollowup.followUpDate = new Date(followUpDate);
      if (followUpTime) targetFollowup.followUpTime = followUpTime;

      if (status === 'Completed') {
        targetFollowup.completedAt = new Date();
        targetFollowup.completedBy = req.user?.name || 'User';

        targetLead.timeline.push({
          eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
          eventType: 'FOLLOWUP_UPDATED',
          title: 'Follow-Up Completed',
          description: `Follow-up (${targetFollowup.reason || 'Callback'}) completed by ${req.user?.name || 'User'}.`,
          author: req.user?.name || 'User',
          timestamp: new Date(),
        });
      }

      // Recalculate lead scoring
      const scoring = calculateLeadScore(targetLead);
      targetLead.leadScore = scoring.score;
      targetLead.leadTemperature = scoring.temperature;
      targetLead.updatedAt = new Date();
      await targetLead.save();

      // Audit Log
      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead.leadId || targetLead._id,
        action: status === 'Completed' ? 'FOLLOWUP_COMPLETED' : 'FOLLOWUP_UPDATED',
        operator: req.user,
        prior_state: { status: priorStatus, followUpId: id },
        updated_state: { status: targetFollowup.status, remarks: targetFollowup.remarks, followUpId: id },
        delta: `Follow-up ${id} ${status === 'Completed' ? 'completed' : 'updated'} by ${req.user?.name || 'User'}`,
        req,
      });

      const enrichedLead = enrichLeadWithScoringAndFollowUp(targetLead);
      if (io) io.emit('leads:updated', { lead: enrichedLead, action: 'followup_updated' });

      return res.json({
        success: true,
        message: 'Follow-up updated successfully',
        followup: targetFollowup,
        lead: enrichedLead,
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update follow-up', error: error.message });
  }
});

module.exports = router;
