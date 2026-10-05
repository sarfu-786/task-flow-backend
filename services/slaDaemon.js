const Lead = require('../models/Lead');
const Complaint = require('../models/Complaint');
const Notification = require('../models/Notification');
const { fallbackStore } = require('../config/db');
const { logAuditAction } = require('./auditService');

let daemonInterval = null;
let ioInstance = null;

/**
 * Initialize the SLA Escalation Daemon
 * @param {Object} io - Socket.io server instance
 */
const initSLADaemon = (io) => {
  ioInstance = io;
  if (daemonInterval) clearInterval(daemonInterval);

  console.log('[SLA Daemon] Intelligent Follow-up Scheduler & SLA Escalation Daemon initialized (30s heartbeat).');

  // Run initial check immediately, then every 30 seconds
  runSLACheck();
  runComplaintSLACheck();
  daemonInterval = setInterval(() => {
    runSLACheck();
    runComplaintSLACheck();
  }, 30000);
};

const runComplaintSLACheck = async () => {
  try {
    const now = new Date();
    const nowMs = now.getTime();

    if (fallbackStore.isFallback) {
      const complaints = fallbackStore.complaints || [];
      let updated = false;

      for (const c of complaints) {
        if (!c || ['Resolved', 'Closed', 'Cancelled'].includes(c.status)) continue;
        if (c.status === 'Awaiting Customer' || c.isPaused) continue;
        if (!c.slaDeadline) continue;

        const deadlineMs = new Date(c.slaDeadline).getTime();
        const diffHours = (deadlineMs - nowMs) / (1000 * 60 * 60);

        if (diffHours < 0 && c.slaStatus !== 'Breached') {
          c.slaStatus = 'Breached';
          updated = true;
          createSystemNotification({
            title: `🚨 SLA Breached: Ticket ${c.ticketNumber}`,
            message: `Complaint from "${c.customerName}" (${c.subject}) has breached SLA resolution deadline.`,
            type: 'complaint_escalated',
            priority: 'Urgent',
            targetRole: 'Manager',
          });
          if (ioInstance) {
            ioInstance.emit('complaint_updated', c);
          }
        } else if (diffHours >= 0 && diffHours <= 4 && c.slaStatus === 'On Track') {
          c.slaStatus = 'At Risk';
          updated = true;
          if (ioInstance) {
            ioInstance.emit('complaint_updated', c);
          }
        }
      }

      if (updated) fallbackStore.saveToFile();
    } else {
      const activeComplaints = await Complaint.find({
        status: { $nin: ['Resolved', 'Closed', 'Cancelled', 'Awaiting Customer'] },
        isPaused: { $ne: true },
        slaDeadline: { $ne: null },
      });

      for (const c of activeComplaints) {
        const deadlineMs = new Date(c.slaDeadline).getTime();
        const diffHours = (deadlineMs - nowMs) / (1000 * 60 * 60);

        if (diffHours < 0 && c.slaStatus !== 'Breached') {
          c.slaStatus = 'Breached';
          await c.save();
          createSystemNotification({
            title: `🚨 SLA Breached: Ticket ${c.ticketNumber}`,
            message: `Complaint from "${c.customerName}" (${c.subject}) has breached SLA resolution deadline.`,
            type: 'complaint_escalated',
            priority: 'Urgent',
            targetRole: 'Manager',
          });
          if (ioInstance) {
            ioInstance.emit('complaint_updated', c.toObject());
          }
        } else if (diffHours >= 0 && diffHours <= 4 && c.slaStatus === 'On Track') {
          c.slaStatus = 'At Risk';
          await c.save();
          if (ioInstance) {
            ioInstance.emit('complaint_updated', c.toObject());
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Complaint SLA Daemon Notice]', err.message);
  }
};

/**
 * Stop the SLA Escalation Daemon
 */
const stopSLADaemon = () => {
  if (daemonInterval) {
    clearInterval(daemonInterval);
    daemonInterval = null;
    console.log('[SLA Daemon] Stopped.');
  }
};

/**
 * Core SLA Evaluation Function
 */
const runSLACheck = async () => {
  try {
    const now = new Date();
    const nowMs = now.getTime();

    if (fallbackStore.isFallback) {
      const leads = fallbackStore.leads || [];
      let updatedCount = 0;

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        if (!lead || !lead.next_followup_at) continue;

        // Skip closed or lost leads
        const status = (lead.status || lead.lead_status || '').toUpperCase();
        if (['CONVERTED', 'LOST'].includes(status)) continue;

        const followupMs = new Date(lead.next_followup_at).getTime();
        const diffMinutes = Math.floor((nowMs - followupMs) / (1000 * 60));

        // Tier 3 Escalation: Overdue by >= 60 minutes
        if (diffMinutes >= 60 && (lead.sla_tier || 0) < 3) {
          const prior = { ...lead };
          lead.sla_tier = 3;
          lead.sla_unassigned = true;
          lead.is_high_priority_pool = true;
          const oldAssignee = lead.assignedTo || 'Assigned Agent';
          lead.assignedTo = 'Unassigned (High-Priority Queue)';
          lead.user = null;
          lead.updatedAt = new Date();

          updatedCount++;

          // Create in-app system notification
          createSystemNotification({
            title: `⚡ Tier 3 SLA Escalation: Lead Auto-Unassigned`,
            message: `Lead "${lead.name}" (${lead.company || 'Enterprise'}) was overdue by 60+ minutes from scheduled follow-up. Automatically unassigned from ${oldAssignee} and placed in High-Priority shared pool.`,
            type: 'sla_alert',
            priority: 'Urgent',
            targetRole: 'Manager',
          });

          logAuditAction({
            entity_type: 'Lead',
            entity_id: lead._id || lead.lead_id,
            action: 'SLA_TIER3_UNASSIGNMENT',
            prior_state: prior,
            updated_state: lead,
            delta: `SLA Tier 3 Breached: Overdue ${diffMinutes}m. Auto-unassigned from ${oldAssignee}.`,
          });

          if (ioInstance) {
            ioInstance.emit('sla:breach', {
              tier: 3,
              leadId: lead._id,
              leadName: lead.name,
              message: `Tier 3 SLA breach for ${lead.name}. Auto-unassigned to high-priority pool.`,
            });
            ioInstance.emit('leads:updated', { lead, action: 'sla_escalated' });
          }
        }
        // Tier 2 Escalation: Overdue by >= 30 minutes
        else if (diffMinutes >= 30 && (lead.sla_tier || 0) < 2) {
          const prior = { ...lead };
          lead.sla_tier = 2;
          lead.sla_escalated_to_lead = true;
          lead.sla_breached_at = lead.sla_breached_at || new Date();
          lead.updatedAt = new Date();

          updatedCount++;

          createSystemNotification({
            title: `🚨 Tier 2 SLA Escalation: 30m Overdue Alert`,
            message: `Lead "${lead.name}" assigned to ${lead.assignedTo} has passed follow-up time by 30+ minutes without disposition update. Flagged to Team Leads.`,
            type: 'sla_alert',
            priority: 'High',
            targetRole: 'Manager',
          });

          logAuditAction({
            entity_type: 'Lead',
            entity_id: lead._id || lead.lead_id,
            action: 'SLA_TIER2_ESCALATION',
            prior_state: prior,
            updated_state: lead,
            delta: `SLA Tier 2 Breached: Overdue ${diffMinutes}m. Escalated to Team Lead workspace.`,
          });

          if (ioInstance) {
            ioInstance.emit('sla:breach', {
              tier: 2,
              leadId: lead._id,
              leadName: lead.name,
              message: `Tier 2 SLA alert for ${lead.name} (${lead.assignedTo}).`,
            });
            ioInstance.emit('leads:updated', { lead, action: 'sla_tier2' });
          }
        }
        // Tier 1 Warning: Overdue by >= 15 minutes
        else if (diffMinutes >= 15 && (lead.sla_tier || 0) < 1) {
          const prior = { ...lead };
          lead.sla_tier = 1;
          lead.sla_breached_at = new Date();
          lead.updatedAt = new Date();

          updatedCount++;

          createSystemNotification({
            title: `⚠️ Tier 1 SLA Warning: Follow-up Overdue`,
            message: `Scheduled follow-up for lead "${lead.name}" is overdue by 15 minutes. Please log an outreach disposition.`,
            type: 'sla_alert',
            priority: 'Medium',
            targetUser: lead.assignedTo,
          });

          logAuditAction({
            entity_type: 'Lead',
            entity_id: lead._id || lead.lead_id,
            action: 'SLA_TIER1_BREACH',
            prior_state: prior,
            updated_state: lead,
            delta: `SLA Tier 1 Breached: Overdue ${diffMinutes}m. Push notification delivered to ${lead.assignedTo}.`,
          });

          if (ioInstance) {
            ioInstance.emit('sla:breach', {
              tier: 1,
              leadId: lead._id,
              leadName: lead.name,
              assignedTo: lead.assignedTo,
              message: `Tier 1 SLA warning: ${lead.name} follow-up overdue by 15m.`,
            });
            ioInstance.emit('leads:updated', { lead, action: 'sla_tier1' });
          }
        }
      }

      if (updatedCount > 0) {
        fallbackStore.saveToFile();
      }
    } else {
      // MongoDB Live Database Check
      const activeLeads = await Lead.find({
        next_followup_at: { $ne: null },
        status: { $nin: ['Converted', 'Lost'] },
        lead_status: { $nin: ['CONVERTED', 'LOST'] },
      });

      for (const lead of activeLeads) {
        const followupMs = new Date(lead.next_followup_at).getTime();
        const diffMinutes = Math.floor((nowMs - followupMs) / (1000 * 60));

        if (diffMinutes >= 60 && (lead.sla_tier || 0) < 3) {
          const prior = lead.toObject();
          const oldAssignee = lead.assignedTo || 'Assigned Agent';

          lead.sla_tier = 3;
          lead.sla_unassigned = true;
          lead.is_high_priority_pool = true;
          lead.assignedTo = 'Unassigned (High-Priority Queue)';
          lead.user = null;
          lead.updatedAt = new Date();
          await lead.save();

          createSystemNotification({
            title: `⚡ Tier 3 SLA Escalation: Lead Auto-Unassigned`,
            message: `Lead "${lead.name}" (${lead.company || 'Enterprise'}) was overdue by 60+ minutes from scheduled follow-up. Automatically unassigned from ${oldAssignee} and placed in High-Priority shared pool.`,
            type: 'sla_alert',
            priority: 'Urgent',
            targetRole: 'Manager',
          });

          logAuditAction({
            entity_type: 'Lead',
            entity_id: lead._id,
            action: 'SLA_TIER3_UNASSIGNMENT',
            prior_state: prior,
            updated_state: lead.toObject(),
            delta: `SLA Tier 3 Breached: Overdue ${diffMinutes}m. Auto-unassigned from ${oldAssignee}.`,
          });

          if (ioInstance) {
            ioInstance.emit('sla:breach', {
              tier: 3,
              leadId: lead._id,
              leadName: lead.name,
              message: `Tier 3 SLA breach for ${lead.name}. Auto-unassigned to high-priority pool.`,
            });
            ioInstance.emit('leads:updated', { lead: lead.toObject(), action: 'sla_escalated' });
          }
        } else if (diffMinutes >= 30 && (lead.sla_tier || 0) < 2) {
          const prior = lead.toObject();
          lead.sla_tier = 2;
          lead.sla_escalated_to_lead = true;
          lead.sla_breached_at = lead.sla_breached_at || new Date();
          lead.updatedAt = new Date();
          await lead.save();

          createSystemNotification({
            title: `🚨 Tier 2 SLA Escalation: 30m Overdue Alert`,
            message: `Lead "${lead.name}" assigned to ${lead.assignedTo} has passed follow-up time by 30+ minutes without disposition update. Flagged to Team Leads.`,
            type: 'sla_alert',
            priority: 'High',
            targetRole: 'Manager',
          });

          logAuditAction({
            entity_type: 'Lead',
            entity_id: lead._id,
            action: 'SLA_TIER2_ESCALATION',
            prior_state: prior,
            updated_state: lead.toObject(),
            delta: `SLA Tier 2 Breached: Overdue ${diffMinutes}m. Escalated to Team Lead workspace.`,
          });

          if (ioInstance) {
            ioInstance.emit('sla:breach', {
              tier: 2,
              leadId: lead._id,
              leadName: lead.name,
              message: `Tier 2 SLA alert for ${lead.name} (${lead.assignedTo}).`,
            });
            ioInstance.emit('leads:updated', { lead: lead.toObject(), action: 'sla_tier2' });
          }
        } else if (diffMinutes >= 15 && (lead.sla_tier || 0) < 1) {
          const prior = lead.toObject();
          lead.sla_tier = 1;
          lead.sla_breached_at = new Date();
          lead.updatedAt = new Date();
          await lead.save();

          createSystemNotification({
            title: `⚠️ Tier 1 SLA Warning: Follow-up Overdue`,
            message: `Scheduled follow-up for lead "${lead.name}" is overdue by 15 minutes. Please log an outreach disposition.`,
            type: 'sla_alert',
            priority: 'Medium',
            targetUser: lead.assignedTo,
          });

          logAuditAction({
            entity_type: 'Lead',
            entity_id: lead._id,
            action: 'SLA_TIER1_BREACH',
            prior_state: prior,
            updated_state: lead.toObject(),
            delta: `SLA Tier 1 Breached: Overdue ${diffMinutes}m. Push notification delivered to ${lead.assignedTo}.`,
          });

          if (ioInstance) {
            ioInstance.emit('sla:breach', {
              tier: 1,
              leadId: lead._id,
              leadName: lead.name,
              assignedTo: lead.assignedTo,
              message: `Tier 1 SLA warning: ${lead.name} follow-up overdue by 15m.`,
            });
            ioInstance.emit('leads:updated', { lead: lead.toObject(), action: 'sla_tier1' });
          }
        }
      }
    }
  } catch (err) {
    console.error('[SLA Daemon Error]', err.message);
  }
};

/**
 * Helper to dispatch in-app notifications
 */
const createSystemNotification = async ({ title, message, type = 'info', priority = 'Medium', targetUser = null, targetRole = null }) => {
  try {
    const notif = {
      _id: 'notif_' + Math.random().toString(16).substring(2, 10),
      title,
      message,
      type,
      priority,
      targetUser,
      targetRole,
      read: false,
      createdAt: new Date(),
    };

    if (fallbackStore.isFallback) {
      if (!fallbackStore.notifications) fallbackStore.notifications = [];
      fallbackStore.notifications.unshift(notif);
      if (fallbackStore.notifications.length > 500) fallbackStore.notifications.length = 500;
    } else {
      try {
        await Notification.create(notif);
      } catch (e) {
        // fallback to memory
        if (!fallbackStore.notifications) fallbackStore.notifications = [];
        fallbackStore.notifications.unshift(notif);
      }
    }

    if (ioInstance) {
      if (targetUser) {
        ioInstance.to(`user:${targetUser.toLowerCase()}`).emit('notification:new', notif);
      } else if (targetRole) {
        ioInstance.to(`role:${targetRole}`).emit('notification:new', notif);
      } else {
        ioInstance.emit('notification:new', notif);
      }
    }
  } catch (e) {
    console.warn('[Notification Notice]', e.message);
  }
};

module.exports = {
  initSLADaemon,
  stopSLADaemon,
  runSLACheck,
};
