const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// @route   PUT /api/followups/:id
// @desc    Update a follow-up across leads
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

      targetLead.updatedAt = new Date();
      fallbackStore.saveToFile();

      if (io) io.emit('leads:updated', { lead: targetLead, action: 'followup_updated' });

      return res.json({
        success: true,
        message: 'Follow-up updated successfully',
        followup: targetFollowup,
        lead: targetLead,
      });
    } else {
      const targetLead = await Lead.findOne({
        $or: [{ 'followups.followUpId': id }, { 'followups._id': id }],
      });

      if (!targetLead) {
        return res.status(404).json({ success: false, message: 'Follow-up record not found' });
      }

      const targetFollowup = targetLead.followups.find((f) => f.followUpId === id || f._id?.toString() === id);
      if (!targetFollowup) {
        return res.status(404).json({ success: false, message: 'Follow-up record not found' });
      }

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

      targetLead.updatedAt = new Date();
      await targetLead.save();

      if (io) io.emit('leads:updated', { lead: targetLead, action: 'followup_updated' });

      return res.json({
        success: true,
        message: 'Follow-up updated successfully',
        followup: targetFollowup,
        lead: targetLead,
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update follow-up', error: error.message });
  }
});

module.exports = router;
