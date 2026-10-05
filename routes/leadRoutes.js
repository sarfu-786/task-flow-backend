const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const XLSX = require('xlsx');
const Lead = require('../models/Lead');
const Opportunity = require('../models/Opportunity');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');
const { logAuditAction } = require('../services/auditService');

// Helper to check if Lead Management module is active
const isLeadModuleActive = () => {
  const activeMods = fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects'];
  return activeMods.includes('leads');
};

const requireLeadModule = (req, res, next) => {
  if (!isLeadModuleActive()) {
    return res.status(403).json({
      success: false,
      moduleDisabled: true,
      message: 'Lead Management module is not activated for your organization.',
    });
  }
  next();
};

router.use(requireLeadModule);

const VALID_STATUSES = [
  'New',
  'Contacted',
  'Follow-Up',
  'Qualified',
  'Interested',
  'Converted',
  'Not Interested',
  'Invalid',
  'In Progress',
  'Lost',
];

const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const VALID_DISPOSITIONS = ['NO_ANSWER', 'BUSY', 'CALL_BACK', 'NOT_INTERESTED', 'QUALIFIED_OPPORTUNITY', 'NONE'];

const {
  getAllUsers,
  getUserScopeContext,
  isLeadAccessible,
  getSubordinateUserIds,
  escapeRegex,
} = require('../services/hierarchyService');

// Helper to generate next sequential human-readable Lead ID (LD-001, LD-002, ...)
const generateNextLeadId = async () => {
  let count = 0;
  if (fallbackStore.isFallback) {
    count = (fallbackStore.leads || []).length;
  } else {
    count = await Lead.countDocuments();
  }
  const nextNum = count + 1;
  return `LD-${String(nextNum).padStart(3, '0')}`;
};

// Helper to generate next sequential human-readable Opportunity ID (OP-001, OP-002, ...)
const generateNextOpportunityId = async () => {
  let count = 0;
  if (fallbackStore.isFallback) {
    count = (fallbackStore.opportunities || []).length;
  } else {
    count = await Opportunity.countDocuments();
  }
  const nextNum = count + 1;
  return `OP-${String(nextNum).padStart(3, '0')}`;
};

/**
 * Validates organizational hierarchy assignment rules for Leads
 */
const validateHierarchyAssignment = async (assignerUser, targetAssignedTo) => {
  if (!assignerUser || !targetAssignedTo) return { valid: true };

  const assignerRole = assignerUser.role || 'User';
  const isSuperAdmin = assignerRole === 'Super Admin';
  const isManager = ['Manager', 'Executive', 'Administrator'].includes(assignerRole);
  const assignerId = (assignerUser._id ? assignerUser._id.toString() : (assignerUser.id ? assignerUser.id.toString() : '')).trim();

  let targetUser = null;
  const cleanTarget = targetAssignedTo.toString().trim().toLowerCase();

  let allUsers = [];
  if (fallbackStore.isFallback) {
    allUsers = fallbackStore.users || [];
    targetUser = allUsers.find(
      (u) =>
        (u.name && u.name.trim().toLowerCase() === cleanTarget) ||
        (u.username && u.username.trim().toLowerCase() === cleanTarget) ||
        (u.email && u.email.trim().toLowerCase() === cleanTarget) ||
        (u._id && u._id.toString() === targetAssignedTo.toString().trim())
    );
  } else {
    allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    if (mongoose.Types.ObjectId.isValid(targetAssignedTo)) {
      targetUser = allUsers.find((u) => u._id && u._id.toString() === targetAssignedTo.toString());
    }
    if (!targetUser) {
      targetUser = allUsers.find(
        (u) =>
          (u.name && u.name.trim().toLowerCase() === cleanTarget) ||
          (u.username && u.username.trim().toLowerCase() === cleanTarget) ||
          (u.email && u.email.trim().toLowerCase() === cleanTarget)
      );
    }
  }

  if (!targetUser) {
    return { valid: true, targetUser: null };
  }

  const targetId = (targetUser._id ? targetUser._id.toString() : (targetUser.id ? targetUser.id.toString() : '')).trim();
  const targetRole = targetUser.role || 'User';

  // 1. Anyone can assign to themselves
  if (assignerId && targetId && assignerId === targetId) {
    return { valid: true, targetUser };
  }

  // 2. Super Admin can assign to anyone
  if (isSuperAdmin) {
    return { valid: true, targetUser };
  }

  // 3. Seniors check
  if (targetRole === 'Super Admin') {
    return {
      valid: false,
      message: `${isManager ? 'Managers' : 'Users'} cannot assign leads to Super Admin. Leads can only be assigned to yourself or your junior subordinates.`,
      targetUser,
    };
  }

  if (!isManager && !isSuperAdmin && (targetRole === 'Manager' || targetRole === 'Executive' || targetRole === 'Administrator')) {
    return {
      valid: false,
      message: `Users cannot assign leads to managers. Leads can only be assigned to yourself or your junior subordinates.`,
      targetUser,
    };
  }

  const subordinateIds = getSubordinateUserIds(assignerUser, allUsers);
  const isJuniorInHierarchy = subordinateIds.has(targetId);

  if (!isJuniorInHierarchy) {
    return {
      valid: false,
      message: `Hierarchy Constraint: You can only assign leads to yourself or users who are under you in your team hierarchy. ('${targetUser.name}' is not in your subordinate hierarchy)`,
      targetUser,
    };
  }

  return { valid: true, targetUser };
};

/**
 * Checks if a user has permission to access (view, edit, delete, convert) a specific lead
 */
const canUserAccessLead = (currentUser, lead, allUsers = []) => {
  if (!currentUser || !lead) return false;
  const scope = getUserScopeContext(currentUser, allUsers);
  return isLeadAccessible(scope, lead);
};

/**
 * Creates and dispatches instant notification for lead assignment / creation / reassignment
 */
const createLeadAssignmentNotification = async ({
  lead,
  targetAssignedTo,
  targetUserId,
  assignerUser,
  isReassignment = false,
  io = null,
}) => {
  try {
    const assignerName = assignerUser?.name || 'System / Manager';
    const assignerAvatar = assignerUser?.avatar || '';
    const assignerRole = assignerUser?.role || 'Admin';
    const assignedBy = `${assignerName} (${assignerRole})`;

    // Resolve target user
    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).select('_id name username email role avatar').lean();
    }

    let targetUser = null;
    if (targetUserId) {
      targetUser = allUsers.find(
        (u) => u && u._id && u._id.toString() === targetUserId.toString()
      );
    }
    if (!targetUser && targetAssignedTo) {
      const cleanTarget = targetAssignedTo.toString().trim().toLowerCase();
      targetUser = allUsers.find(
        (u) =>
          (u.name && u.name.trim().toLowerCase() === cleanTarget) ||
          (u.username && u.username.trim().toLowerCase() === cleanTarget) ||
          (u.email && u.email.trim().toLowerCase() === cleanTarget) ||
          (u._id && u._id.toString() === cleanTarget)
      );
    }

    const safeAssignerId = assignerUser && assignerUser._id
      ? (assignerUser._id.toString ? assignerUser._id.toString() : assignerUser._id)
      : undefined;

    const safeRecipientId = targetUser && targetUser._id
      ? (targetUser._id.toString ? targetUser._id.toString() : targetUser._id)
      : (targetUserId ? targetUserId.toString() : undefined);

    const safeLeadId = lead && lead._id
      ? (lead._id.toString ? lead._id.toString() : lead._id)
      : undefined;

    const leadIdFormatted = lead.leadId || 'LD-NEW';
    const leadName = lead.name || lead.contactPerson || 'New Prospect';
    const companyName = lead.company ? `(${lead.company})` : '';
    const dealVal = Number(lead.estimatedValue || lead.dealValue || 0);
    const valueStr = dealVal > 0 ? `₹${dealVal.toLocaleString('en-IN')}` : 'Not Specified';
    const sourceStr = lead.source || 'Direct Website';
    const priorityStr = lead.priority || 'Medium';
    const contactStr = [lead.phone || lead.mobileNumber, lead.email].filter(Boolean).join(' • ') || 'No contact specified';

    const notifTitle = isReassignment
      ? `🎯 Lead Reassigned: ${leadName} [${leadIdFormatted}]`
      : `🎯 New Lead Received: ${leadName} [${leadIdFormatted}]`;

    const notifMessage = isReassignment
      ? `${assignedBy} reassigned lead "${leadName}" ${companyName} to you.`
      : `${assignedBy} assigned you a new lead: "${leadName}" ${companyName}. Value: ${valueStr}, Priority: ${priorityStr}.`;

    const notifDesc = `Lead [${leadIdFormatted}]: ${leadName} ${companyName} • Source: ${sourceStr} • Value: ${valueStr}`;
    const notifRemark = `Contact: ${contactStr} | Priority: ${priorityStr}${lead.requirement ? ` | Req: "${lead.requirement.substring(0, 100)}"` : ''}`;

    const forRole = (targetUser?.role === 'Manager' || targetUser?.role === 'Super Admin') ? 'Manager' : 'User';

    const notifData = {
      user: safeAssignerId,
      recipientUser: safeRecipientId,
      recipientName: targetAssignedTo || targetUser?.name || 'Sales Representative',
      userName: assignerName,
      userAvatar: assignerAvatar,
      assignedBy: assignedBy,
      leadId: safeLeadId,
      leadReadableId: leadIdFormatted,
      taskDescription: notifDesc,
      taskType: 'lead',
      type: 'lead_assigned',
      title: notifTitle,
      message: notifMessage,
      remark: notifRemark,
      isRead: false,
      forRole: forRole,
      createdAt: new Date(),
    };

    let createdNotif = null;

    if (fallbackStore.isFallback) {
      if (!fallbackStore.notifications) {
        fallbackStore.notifications = [];
      }
      const notifId = '64e8c3' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      createdNotif = { _id: notifId, ...notifData };
      fallbackStore.notifications.unshift(createdNotif);
      fallbackStore.saveToFile();
    } else {
      createdNotif = await Notification.create(notifData);
    }

    // Instant Real-Time Socket.io dispatch
    if (io) {
      const payload = {
        notification: createdNotif,
        lead: lead,
        type: 'lead_assigned',
        title: notifTitle,
        message: notifMessage,
        remark: notifRemark,
        leadId: safeLeadId,
        leadReadableId: leadIdFormatted,
        assignedBy: assignedBy,
        forRole: forRole,
        recipientUser: safeRecipientId,
        recipientName: targetAssignedTo || targetUser?.name || '',
      };

      // 1. Send direct to recipient user ID room
      if (safeRecipientId) {
        io.to(`user:${safeRecipientId.toString()}`).emit('notification:new', payload);
        io.to(`user:${safeRecipientId.toString()}`).emit('lead:assigned', { lead, notification: createdNotif });
      }

      // 2. Send direct to recipient username / name rooms
      if (targetAssignedTo) {
        const cleanName = targetAssignedTo.toString().toLowerCase().trim();
        io.to(`user:${cleanName}`).emit('notification:new', payload);
        io.to(`user:${cleanName}`).emit('lead:assigned', { lead, notification: createdNotif });
      }
      if (targetUser?.username) {
        const cleanUsername = targetUser.username.toString().toLowerCase().trim();
        io.to(`user:${cleanUsername}`).emit('notification:new', payload);
      }
      if (targetUser?.name) {
        const cleanTName = targetUser.name.toString().toLowerCase().trim();
        io.to(`user:${cleanTName}`).emit('notification:new', payload);
      }

      // 3. If assigner assigned to self, also emit to assigner's rooms
      if (assignerUser) {
        const aId = assignerUser._id?.toString() || assignerUser.id?.toString();
        const aName = assignerUser.name?.toLowerCase().trim();
        if (targetAssignedTo && aName && targetAssignedTo.toLowerCase().trim() === aName) {
          if (aId) io.to(`user:${aId}`).emit('notification:new', payload);
          if (aName) io.to(`user:${aName}`).emit('notification:new', payload);
        }
      }

      // 4. Update leads list and stats for all connected clients
      io.emit('leads:updated', { lead, action: isReassignment ? 'updated' : 'created' });
      io.emit('stats:updated');
    }

    return createdNotif;
  } catch (err) {
    console.error('[Lead Notification Helper Error]', err.message);
  }
};

/**
 * Creates and dispatches instant notification for scheduled lead follow-ups
 */
const createFollowUpNotification = async ({
  lead,
  followUp,
  assignerUser,
  io = null,
}) => {
  try {
    const targetAssignedTo = followUp.assignedTo || lead.assignedTo;
    if (!targetAssignedTo) return;

    const assignerName = assignerUser?.name || 'System / Manager';
    const assignerAvatar = assignerUser?.avatar || '';
    const assignerRole = assignerUser?.role || 'Admin';
    const assignedBy = `${assignerName} (${assignerRole})`;

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).select('_id name username email role avatar').lean();
    }

    const cleanTarget = targetAssignedTo.toString().trim().toLowerCase();
    const targetUser = allUsers.find(
      (u) =>
        (u.name && u.name.trim().toLowerCase() === cleanTarget) ||
        (u.username && u.username.trim().toLowerCase() === cleanTarget) ||
        (u.email && u.email.trim().toLowerCase() === cleanTarget) ||
        (u._id && u._id.toString() === cleanTarget)
    );

    const safeAssignerId = assignerUser && assignerUser._id
      ? (assignerUser._id.toString ? assignerUser._id.toString() : assignerUser._id)
      : undefined;

    const safeRecipientId = targetUser && targetUser._id
      ? (targetUser._id.toString ? targetUser._id.toString() : targetUser._id)
      : undefined;

    const safeLeadId = lead && lead._id
      ? (lead._id.toString ? lead._id.toString() : lead._id)
      : undefined;

    const leadIdFormatted = lead.leadId || 'LD-NEW';
    const leadName = lead.name || lead.contactPerson || 'Prospect';
    const fDateStr = followUp.followUpDate ? new Date(followUp.followUpDate).toLocaleDateString() : 'Scheduled Date';
    const fTimeStr = followUp.followUpTime || '';

    const notifTitle = `📅 Follow-Up Scheduled: ${leadName} [${leadIdFormatted}]`;
    const notifMessage = `${assignedBy} scheduled a follow-up for lead "${leadName}" on ${fDateStr} ${fTimeStr}.`;
    const notifDesc = `Lead [${leadIdFormatted}]: ${leadName} • Follow-Up Scheduled on ${fDateStr} ${fTimeStr}`;
    const notifRemark = `Reason: ${followUp.reason || 'Lead follow-up'}${followUp.remarks ? ` | Notes: "${followUp.remarks}"` : ''}`;

    const forRole = (targetUser?.role === 'Manager' || targetUser?.role === 'Super Admin') ? 'Manager' : 'User';

    const notifData = {
      user: safeAssignerId,
      recipientUser: safeRecipientId,
      recipientName: targetAssignedTo,
      userName: assignerName,
      userAvatar: assignerAvatar,
      assignedBy: assignedBy,
      leadId: safeLeadId,
      leadReadableId: leadIdFormatted,
      taskDescription: notifDesc,
      taskType: 'lead',
      type: 'lead_assigned',
      title: notifTitle,
      message: notifMessage,
      remark: notifRemark,
      isRead: false,
      forRole: forRole,
      createdAt: new Date(),
    };

    let createdNotif = null;

    if (fallbackStore.isFallback) {
      if (!fallbackStore.notifications) fallbackStore.notifications = [];
      const notifId = '64e8c3' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      createdNotif = { _id: notifId, ...notifData };
      fallbackStore.notifications.unshift(createdNotif);
      fallbackStore.saveToFile();
    } else {
      createdNotif = await Notification.create(notifData);
    }

    if (io) {
      const payload = {
        notification: createdNotif,
        lead: lead,
        followUp: followUp,
        type: 'lead_assigned',
        title: notifTitle,
        message: notifMessage,
        remark: notifRemark,
        leadId: safeLeadId,
        leadReadableId: leadIdFormatted,
      };

      if (safeRecipientId) {
        io.to(`user:${safeRecipientId.toString()}`).emit('notification:new', payload);
      }
      if (targetAssignedTo) {
        io.to(`user:${cleanTarget}`).emit('notification:new', payload);
      }
      if (targetUser?.username) {
        io.to(`user:${targetUser.username.toLowerCase().trim()}`).emit('notification:new', payload);
      }
      io.emit('leads:updated', { lead, action: 'followup_scheduled' });
    }
  } catch (err) {
    console.error('[Follow-Up Notification Helper Error]', err.message);
  }
};

// =========================================================================
// LEAD EXCEL IMPORT & EXPORT SUITE (.XLSX ONLY)
// =========================================================================

// @route   GET /api/leads/excel/template
// @route   GET /api/leads/excel/template
// @desc    Download standard Excel (.xlsx) or CSV (.csv) Import Template with sample data and allowed values
// @access  Private
router.get('/excel/template', protect, (req, res) => {
  try {
    const format = (req.query.format || 'xlsx').toLowerCase();
    const wb = XLSX.utils.book_new();

    // Sheet 1: Template
    const templateData = [
      {
        'Lead ID': '',
        'Full Name *': 'Rahul Sharma',
        'Email *': 'rahul.sharma@innovatecorp.com',
        'Phone': '+91 9876543210',
        'Company': 'Innovate Technologies Pvt Ltd',
        'Job Title': 'Director of Engineering',
        'Lead Source': 'Website',
        'Status': 'New',
        'Priority': 'High',
        'Industry': 'Technology',
        'Estimated Value (INR)': 250000,
        'Assigned To': '',
        'City': 'Bengaluru',
        'Country': 'India',
        'Requirement / Notes': 'Looking for enterprise CRM and task workflow automation.',
      },
      {
        'Lead ID': '',
        'Full Name *': 'Priya Nair',
        'Email *': 'priya.nair@apexfin.com',
        'Phone': '+91 9812345678',
        'Company': 'Apex Financial Solutions',
        'Job Title': 'Operations VP',
        'Lead Source': 'Referral',
        'Status': 'Contacted',
        'Priority': 'Medium',
        'Industry': 'Finance',
        'Estimated Value (INR)': 180000,
        'Assigned To': '',
        'City': 'Mumbai',
        'Country': 'India',
        'Requirement / Notes': 'Requires SLA monitoring and departmental reporting.',
      },
      {
        'Lead ID': '',
        'Full Name *': 'Amit Verma',
        'Email *': 'amit.verma@techglobal.org',
        'Phone': '+91 9988776655',
        'Company': 'Tech Global Solutions',
        'Job Title': 'Chief Product Officer',
        'Lead Source': 'LinkedIn',
        'Status': 'Qualified',
        'Priority': 'Urgent',
        'Industry': 'Technology',
        'Estimated Value (INR)': 420000,
        'Assigned To': '',
        'City': 'Hyderabad',
        'Country': 'India',
        'Requirement / Notes': 'Enterprise multi-team project and opportunity management setup.',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 22 },
      { wch: 32 },
      { wch: 18 },
      { wch: 30 },
      { wch: 24 },
      { wch: 16 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 22 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 45 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Leads Template');

    if (format === 'csv') {
      const csvBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="Lead_Import_Template.csv"');
      return res.send(csvBuffer);
    }

    // Sheet 2: Reference Guide (for Excel)
    const guideData = [
      { 'Field': 'Lead ID', 'Mandatory': 'No (Only for Updates)', 'Description': 'Provide existing Lead ID (e.g. LD-001) to update an existing record. Leave blank to create a new lead.' },
      { 'Field': 'Full Name *', 'Mandatory': 'YES', 'Description': 'Full name of the contact or prospect.' },
      { 'Field': 'Email *', 'Mandatory': 'YES (or Phone)', 'Description': 'Valid email address. Used for duplicate detection and communications.' },
      { 'Field': 'Phone', 'Mandatory': 'Optional (or Email)', 'Description': 'Contact telephone or mobile number with country code.' },
      { 'Field': 'Company', 'Mandatory': 'Optional', 'Description': 'Organization or business account name.' },
      { 'Field': 'Lead Source', 'Mandatory': 'Optional', 'Description': 'Allowed: Website, Justdial, Instamart, IndiaMART, TradeIndia, Google Ads, Meta Ads, LinkedIn, WhatsApp, Referral, Cold Call, Inbound Call, Email Campaign, Event / Expo, Walk-In, Other (Default: Website)' },
      { 'Field': 'Status', 'Mandatory': 'Optional', 'Description': 'Allowed: New, Contacted, Follow-Up, Qualified, Interested, Converted, Not Interested, Invalid, In Progress, Lost (Default: New)' },
      { 'Field': 'Priority', 'Mandatory': 'Optional', 'Description': 'Allowed: Low, Medium, High, Urgent (Default: Medium)' },
      { 'Field': 'Industry', 'Mandatory': 'Optional', 'Description': 'Allowed: Technology, Finance, Healthcare, Manufacturing, Retail, Consulting, Real Estate, Education, Hospitality, Other' },
      { 'Field': 'Estimated Value (INR)', 'Mandatory': 'Optional', 'Description': 'Numeric expected deal/pipeline value in INR.' },
      { 'Field': 'Assigned To', 'Mandatory': 'Optional', 'Description': 'Name, email, or username of an authorized team member within your hierarchy. If left blank or unauthorized, defaults to you.' },
    ];

    const wsGuide = XLSX.utils.json_to_sheet(guideData);
    wsGuide['!cols'] = [{ wch: 22 }, { wch: 25 }, { wch: 65 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Guide & Allowed Values');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Lead_Import_Template.xlsx"');
    return res.send(buffer);
  } catch (err) {
    console.error('Failed to generate Lead import template:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate Excel template' });
  }
});

// @route   POST /api/leads/excel/preview
// @desc    Validate and preview uploaded Excel/CSV file rows with column mapping support
// @access  Private
router.post('/excel/preview', protect, async (req, res) => {
  try {
    const { fileBase64, fileData, rows: clientRows, filename, fileName, mapping = {} } = req.body;
    const resolvedName = fileName || filename || '';

    if (resolvedName && !/\.(xlsx|xls|csv)$/i.test(resolvedName)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. Supported formats: .xlsx, .xls, .csv',
      });
    }

    let rawRows = [];
    let detectedHeaders = [];
    const payloadBuffer = fileData || fileBase64;

    if (payloadBuffer) {
      try {
        const cleanBase64 = payloadBuffer.includes('base64,') ? payloadBuffer.split('base64,')[1] : payloadBuffer;
        const fileBuffer = Buffer.from(cleanBase64, 'base64');
        const wb = XLSX.read(fileBuffer, { type: 'buffer' });
        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          return res.status(400).json({ success: false, message: 'The uploaded file contains no sheets or data.' });
        }
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

        // Extract header names
        const range = XLSX.utils.decode_range(firstSheet['!ref'] || 'A1:Z1');
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = firstSheet[XLSX.utils.encode_cell({ c: C, r: range.s.r })];
          if (cell && cell.v !== undefined && String(cell.v).trim()) {
            detectedHeaders.push(String(cell.v).trim());
          }
        }
      } catch (parseErr) {
        return res.status(400).json({ success: false, message: 'Failed to parse file: ' + parseErr.message });
      }
    } else if (Array.isArray(clientRows)) {
      rawRows = clientRows;
    } else {
      return res.status(400).json({ success: false, message: 'No file data or rows provided.' });
    }

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'The uploaded file contains no data rows.' });
    }

    if (detectedHeaders.length === 0 && rawRows[0]) {
      detectedHeaders = Object.keys(rawRows[0]);
    }

    // Get current user accessible leads and all system users for hierarchy checking
    let existingLeads = [];
    let allUsers = [];
    if (fallbackStore.isFallback) {
      existingLeads = fallbackStore.leads || [];
      allUsers = fallbackStore.users || [];
    } else {
      existingLeads = await Lead.find({}).lean();
      allUsers = await User.find({}).lean();
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let missingRequiredCount = 0;

    const validatedRows = [];

    for (let idx = 0; idx < rawRows.length; idx++) {
      const rawRow = rawRows[idx];
      const rowIndex = idx + 1;
      const errors = [];
      const warnings = [];

      // Map flexible header keys according to mapping or auto-detection
      const leadId = String((mapping.leadId ? rawRow[mapping.leadId] : null) || rawRow['Lead ID'] || rawRow['leadId'] || rawRow['lead_id'] || rawRow['ID'] || '').trim();
      const name = String((mapping.name ? rawRow[mapping.name] : null) || rawRow['Full Name *'] || rawRow['Full Name'] || rawRow['Name'] || rawRow['name'] || rawRow['Lead Name'] || rawRow['Contact Name'] || '').trim();
      const email = String((mapping.email ? rawRow[mapping.email] : null) || rawRow['Email *'] || rawRow['Email'] || rawRow['email'] || rawRow['Email Address'] || '').trim().toLowerCase();
      const phone = String((mapping.phone ? rawRow[mapping.phone] : null) || rawRow['Phone'] || rawRow['Mobile'] || rawRow['phone'] || rawRow['Mobile Number'] || rawRow['Phone Number'] || '').trim();
      const company = String((mapping.company ? rawRow[mapping.company] : null) || rawRow['Company'] || rawRow['Organization'] || rawRow['company'] || rawRow['Account Name'] || '').trim();
      const jobTitle = String((mapping.jobTitle ? rawRow[mapping.jobTitle] : null) || rawRow['Job Title'] || rawRow['Title'] || rawRow['Designation'] || '').trim();
      let source = String((mapping.source ? rawRow[mapping.source] : null) || rawRow['Lead Source'] || rawRow['Source'] || rawRow['source'] || 'Website').trim();
      let status = String((mapping.status ? rawRow[mapping.status] : null) || rawRow['Status'] || rawRow['status'] || rawRow['Lead Status'] || 'New').trim();
      let priority = String((mapping.priority ? rawRow[mapping.priority] : null) || rawRow['Priority'] || rawRow['priority'] || 'Medium').trim();
      let industry = String((mapping.industry ? rawRow[mapping.industry] : null) || rawRow['Industry'] || rawRow['industry'] || 'Technology').trim();
      const rawValue = (mapping.estimatedValue ? rawRow[mapping.estimatedValue] : null) || rawRow['Estimated Value (INR)'] || rawRow['Estimated Value'] || rawRow['Deal Value'] || rawRow['Value'] || rawRow['Amount'] || 0;
      const estimatedValue = isNaN(Number(rawValue)) ? 0 : Number(rawValue);
      const assignedToRaw = String((mapping.assignedTo ? rawRow[mapping.assignedTo] : null) || rawRow['Assigned To'] || rawRow['assignedTo'] || rawRow['Owner'] || rawRow['Assigned User'] || '').trim();
      const city = String((mapping.city ? rawRow[mapping.city] : null) || rawRow['City'] || rawRow['city'] || '').trim();
      const country = String((mapping.country ? rawRow[mapping.country] : null) || rawRow['Country'] || rawRow['country'] || 'India').trim();
      const notes = String((mapping.notes ? rawRow[mapping.notes] : null) || rawRow['Requirement / Notes'] || rawRow['Requirement'] || rawRow['Notes'] || rawRow['requirement'] || rawRow['Remarks'] || '').trim();

      // Required field validation
      const isMissingReq = !name || (!email && !phone);
      if (isMissingReq) {
        missingRequiredCount++;
      }

      if (!name) {
        errors.push('Lead / Contact Name is required.');
      }
      if (!email && !phone) {
        errors.push('Either Email Address or Phone Number is required.');
      } else {
        if (email && !emailRegex.test(email)) {
          errors.push(`Invalid email format: '${email}'`);
        }
        if (phone && phone.replace(/\D/g, '').length < 7) {
          warnings.push(`Phone number appears short: '${phone}'`);
        }
      }

      // Normalization of enum fields
      if (!VALID_STATUSES.includes(status)) {
        status = 'New';
      }
      if (!VALID_PRIORITIES.includes(priority)) {
        priority = 'Medium';
      }

      // Duplicate Check
      let existingMatch = null;
      if (leadId) {
        existingMatch = existingLeads.find((l) => (l.leadId && l.leadId.toLowerCase() === leadId.toLowerCase()) || (l.lead_id && l.lead_id.toLowerCase() === leadId.toLowerCase()));
      }
      if (!existingMatch && email) {
        existingMatch = existingLeads.find((l) => l.email && l.email.toLowerCase() === email);
      }
      if (!existingMatch && phone) {
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length >= 7) {
          existingMatch = existingLeads.find((l) => {
            const p = (l.phone || l.mobileNumber || '').replace(/\D/g, '');
            return p && p === cleanPhone;
          });
        }
      }

      const isDuplicate = !!existingMatch;
      if (isDuplicate) {
        duplicateCount++;
        warnings.push(`Existing record detected (${existingMatch.leadId || existingMatch.name}). Will be updated if Update/Upsert mode is selected.`);
      }

      // Hierarchy assignment check
      let resolvedAssignedTo = req.user.name || req.user.username;
      let resolvedAssignedToId = req.user._id;

      if (assignedToRaw) {
        const cleanTarget = assignedToRaw.toLowerCase();
        const targetUser = allUsers.find(
          (u) =>
            (u.name && u.name.toLowerCase() === cleanTarget) ||
            (u.username && u.username.toLowerCase() === cleanTarget) ||
            (u.email && u.email.toLowerCase() === cleanTarget) ||
            (u._id && u._id.toString() === assignedToRaw)
        );

        if (targetUser) {
          const assignCheck = await validateHierarchyAssignment(req.user, targetUser._id);
          if (assignCheck.valid) {
            resolvedAssignedTo = targetUser.name || targetUser.username;
            resolvedAssignedToId = targetUser._id;
          } else {
            warnings.push(`Hierarchy Constraint: Cannot assign to '${targetUser.name}'. Defaulting assignment to you (${req.user.name}).`);
          }
        } else {
          warnings.push(`User '${assignedToRaw}' not found in organization. Defaulting to you.`);
        }
      }

      const isValid = errors.length === 0;
      if (isValid) validCount++;
      else invalidCount++;

      validatedRows.push({
        rowIndex,
        leadId: leadId || (existingMatch ? existingMatch.leadId : ''),
        name,
        email,
        phone,
        company,
        jobTitle,
        source,
        status,
        priority,
        industry,
        estimatedValue,
        assignedTo: resolvedAssignedTo,
        assignedToId: resolvedAssignedToId,
        city,
        country,
        notes,
        isValid,
        validationStatus: !isValid ? 'error' : isDuplicate ? 'warning' : 'valid',
        errors,
        warnings,
        isDuplicate,
        existingId: existingMatch ? existingMatch._id : null,
      });
    }

    return res.json({
      success: true,
      headers: detectedHeaders,
      rawRows: rawRows.slice(0, 5),
      totalRows: validatedRows.length,
      validCount,
      invalidCount,
      duplicateCount,
      missingRequiredCount,
      rows: validatedRows,
    });
  } catch (err) {
    console.error('Lead Excel preview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process file preview: ' + err.message });
  }
});

// @route   POST /api/leads/excel/import
// @desc    Execute batch import of valid Lead records from preview
// @access  Private
router.post('/excel/import', protect, async (req, res) => {
  try {
    const { rows, mode = 'create' } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows provided for import.' });
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];
    const importedLeads = [];

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).lean();
    }

    for (const row of rows) {
      if (!row.name || (!row.email && !row.phone)) {
        skippedCount++;
        continue;
      }

      try {
        if (fallbackStore.isFallback) {
          if (!fallbackStore.leads) fallbackStore.leads = [];

          let existingIndex = -1;
          if (row.existingId) {
            existingIndex = fallbackStore.leads.findIndex((l) => l._id && l._id.toString() === row.existingId.toString());
          }
          if (existingIndex === -1 && row.leadId) {
            existingIndex = fallbackStore.leads.findIndex((l) => l.leadId && l.leadId.toLowerCase() === row.leadId.toLowerCase());
          }
          if (existingIndex === -1 && row.email) {
            existingIndex = fallbackStore.leads.findIndex((l) => l.email && l.email.toLowerCase() === row.email.toLowerCase());
          }

          if (existingIndex !== -1) {
            if (mode === 'update' || mode === 'upsert') {
              const existing = fallbackStore.leads[existingIndex];
              // Check permission to update
              if (!canUserAccessLead(req.user, existing, allUsers)) {
                skippedCount++;
                errors.push(`Access denied for updating lead ${existing.leadId || row.name}`);
                continue;
              }

              const updatedLead = {
                ...existing,
                name: row.name || existing.name,
                contactPerson: row.name || existing.contactPerson,
                email: row.email || existing.email,
                phone: row.phone || existing.phone,
                mobileNumber: row.phone || existing.mobileNumber,
                company: row.company || existing.company,
                jobTitle: row.jobTitle || existing.jobTitle,
                source: row.source || existing.source,
                status: row.status || existing.status,
                priority: row.priority || existing.priority,
                industry: row.industry || existing.industry,
                estimatedValue: row.estimatedValue !== undefined ? Number(row.estimatedValue) : existing.estimatedValue,
                dealValue: row.estimatedValue !== undefined ? Number(row.estimatedValue) : existing.dealValue,
                requirement: row.notes || existing.requirement,
                city: row.city || existing.city,
                country: row.country || existing.country,
                updatedAt: new Date().toISOString(),
              };

              fallbackStore.leads[existingIndex] = updatedLead;
              updatedCount++;
              importedLeads.push(updatedLead);
            } else {
              // Duplicate skipped
              skippedCount++;
              errors.push(`Duplicate skipped: Lead '${row.name}' (${fallbackStore.leads[existingIndex].leadId || row.email || row.phone}) already exists.`);
              continue;
            }
          } else {
            // Create mode
            const newLeadId = await generateNextLeadId();
            const leadDocId = '64e8c3' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
            const newLead = {
              _id: leadDocId,
              lead_id: 'lead_' + crypto.randomUUID(),
              leadId: newLeadId,
              name: row.name,
              contactPerson: row.name,
              email: row.email || '',
              phone: row.phone || '',
              mobileNumber: row.phone || '',
              company: row.company || '',
              jobTitle: row.jobTitle || '',
              source: row.source || 'Website',
              status: row.status || 'New',
              priority: row.priority || 'Medium',
              industry: row.industry || 'Technology',
              estimatedValue: Number(row.estimatedValue) || 0,
              dealValue: Number(row.estimatedValue) || 0,
              assignedTo: row.assignedTo || req.user.name || 'Unassigned',
              assigned_to: row.assignedTo || req.user.name || 'Unassigned',
              assignedManager: req.user.role === 'Manager' ? req.user.name : (req.user.reportsToName || ''),
              requirement: row.notes || '',
              city: row.city || '',
              country: row.country || 'India',
              createdBy: req.user._id || req.user.id,
              createdByName: req.user.name || req.user.username,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              activities: [
                {
                  id: 'act_' + Date.now(),
                  type: 'Created',
                  subject: 'Lead Imported via Excel/CSV',
                  content: `Lead created via bulk import by ${req.user.name || req.user.username}.`,
                  performedBy: req.user.name || req.user.username,
                  timestamp: new Date().toISOString(),
                },
              ],
            };

            fallbackStore.leads.unshift(newLead);
            createdCount++;
            importedLeads.push(newLead);
          }
        } else {
          // MongoDB Live Store
          let existing = null;
          if (row.existingId) existing = await Lead.findById(row.existingId);
          if (!existing && row.leadId) existing = await Lead.findOne({ leadId: row.leadId });
          if (!existing && row.email) existing = await Lead.findOne({ email: row.email });
          if (!existing && row.phone) {
            const cleanPhone = row.phone.replace(/\D/g, '');
            if (cleanPhone.length >= 7) {
              existing = await Lead.findOne({
                $or: [{ phone: row.phone }, { mobileNumber: row.phone }],
              });
            }
          }

          if (existing) {
            if (mode === 'update' || mode === 'upsert') {
              if (!canUserAccessLead(req.user, existing.toObject(), allUsers)) {
                skippedCount++;
                errors.push(`Access denied for updating lead ${existing.leadId || row.name}`);
                continue;
              }

              existing.name = row.name || existing.name;
              existing.contactPerson = row.name || existing.contactPerson;
              if (row.email) existing.email = row.email;
              if (row.phone) existing.phone = row.phone;
              if (row.company) existing.company = row.company;
              if (row.jobTitle) existing.jobTitle = row.jobTitle;
              if (row.source) existing.source = row.source;
              if (row.status) existing.status = row.status;
              if (row.priority) existing.priority = row.priority;
              if (row.industry) existing.industry = row.industry;
              if (row.estimatedValue !== undefined) {
                existing.estimatedValue = Number(row.estimatedValue);
                existing.dealValue = Number(row.estimatedValue);
              }
              if (row.notes) existing.requirement = row.notes;
              if (row.city) existing.city = row.city;
              if (row.country) existing.country = row.country;
              existing.updatedAt = new Date();

              await existing.save();
              updatedCount++;
              importedLeads.push(existing.toObject());
            } else {
              // Duplicate skipped
              skippedCount++;
              errors.push(`Duplicate skipped: Lead '${row.name}' (${existing.leadId || row.email || row.phone}) already exists.`);
              continue;
            }
          } else {
            const nextLeadId = await generateNextLeadId();
            const created = await Lead.create({
              name: row.name,
              contactPerson: row.name,
              email: row.email || '',
              phone: row.phone || '',
              mobileNumber: row.phone || '',
              company: row.company || '',
              jobTitle: row.jobTitle || '',
              leadId: nextLeadId,
              source: row.source || 'Website',
              status: row.status || 'New',
              priority: row.priority || 'Medium',
              industry: row.industry || 'Technology',
              estimatedValue: Number(row.estimatedValue) || 0,
              dealValue: Number(row.estimatedValue) || 0,
              assignedTo: row.assignedTo || req.user.name || 'Unassigned',
              assigned_to: row.assignedTo || req.user.name || 'Unassigned',
              assignedManager: req.user.role === 'Manager' ? req.user.name : (req.user.reportsToName || ''),
              requirement: row.notes || '',
              city: row.city || '',
              country: row.country || 'India',
              createdBy: req.user._id,
              createdByName: req.user.name || req.user.username,
              activities: [
                {
                  id: 'act_' + Date.now(),
                  type: 'Created',
                  subject: 'Lead Imported via Excel/CSV',
                  content: `Lead created via bulk import by ${req.user.name || req.user.username}.`,
                  performedBy: req.user.name || req.user.username,
                  timestamp: new Date(),
                },
              ],
            });
            createdCount++;
            importedLeads.push(created.toObject());
          }
        }
      } catch (rowErr) {
        skippedCount++;
        errors.push(`Row ${row.rowIndex || ''} (${row.name}): ${rowErr.message}`);
      }
    }

    if (fallbackStore.isFallback) {
      fallbackStore.saveToFile();
    }

    // Save history record
    const historyEntry = {
      id: 'imp_' + Date.now(),
      entityType: 'Lead',
      type: 'IMPORT',
      filename: req.body.filename || 'leads_import.xlsx',
      mode,
      totalRows: rows.length,
      createdCount,
      updatedCount,
      skippedCount,
      performedBy: req.user.name || req.user.username,
      performedById: req.user._id,
      timestamp: new Date().toISOString(),
      status: errors.length > 0 && createdCount === 0 && updatedCount === 0 ? 'Failed' : 'Completed',
    };

    if (!fallbackStore.importHistory) fallbackStore.importHistory = [];
    fallbackStore.importHistory.unshift(historyEntry);
    fallbackStore.saveToFile();

    await logAuditAction({
      entity_type: 'Lead',
      entity_id: 'EXCEL_BATCH_IMPORT',
      action: 'IMPORT_EXCEL',
      operator: req.user,
      delta: `Imported ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped from Excel`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('leads:updated', { action: 'imported', createdCount, updatedCount });
      io.emit('notification:new', {
        title: '📊 Leads Excel Import Completed',
        message: `${createdCount} leads created, ${updatedCount} updated by ${req.user.name}.`,
        type: 'system',
        createdAt: new Date(),
      });
    }

    return res.json({
      success: true,
      message: `Import completed: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped.`,
      createdCount,
      updatedCount,
      skippedCount,
      totalProcessed: rows.length,
      errors,
    });
  } catch (err) {
    console.error('Lead Excel import error:', err);
    return res.status(500).json({ success: false, message: 'Import execution failed: ' + err.message });
  }
});

// @route   POST /api/leads/excel/export or GET /api/leads/excel/export
// @desc    Export filtered / selected / all accessible leads strictly adhering to hierarchy
// @access  Private
router.all('/excel/export', protect, async (req, res) => {
  try {
    const isPost = req.method === 'POST';
    const params = isPost ? req.body : req.query;
    const { selectedIds, search, status, priority, source, assignedTo, conversionStatus } = params;

    let leads = [];
    let allUsers = [];

    if (fallbackStore.isFallback) {
      leads = fallbackStore.leads || [];
      allUsers = fallbackStore.users || [];
    } else {
      leads = await Lead.find({}).lean();
      allUsers = await User.find({}).lean();
    }

    const scope = getUserScopeContext(req.user, allUsers);
    if (!scope.isSuperAdmin) {
      leads = leads.filter((l) => isLeadAccessible(scope, l));
    }

    // Filter by selected IDs if specified
    if (Array.isArray(selectedIds) && selectedIds.length > 0) {
      leads = leads.filter((l) => selectedIds.includes(l._id?.toString()) || selectedIds.includes(l.leadId) || selectedIds.includes(l.lead_id));
    } else {
      // Apply active filters
      if (status && status !== 'all') {
        leads = leads.filter((l) => l.status === status);
      }
      if (priority && priority !== 'all') {
        leads = leads.filter((l) => l.priority === priority);
      }
      if (source && source !== 'all') {
        leads = leads.filter((l) => l.source === source);
      }
      if (assignedTo && assignedTo !== 'all') {
        leads = leads.filter((l) => l.assignedTo === assignedTo || l.assigned_to === assignedTo);
      }
      if (conversionStatus && conversionStatus !== 'all') {
        if (conversionStatus === 'converted') {
          leads = leads.filter((l) => l.status === 'Converted' || !!l.opportunityId || !!l.convertedOpportunityId);
        } else if (conversionStatus === 'unconverted') {
          leads = leads.filter((l) => l.status !== 'Converted');
        }
      }
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        leads = leads.filter(
          (l) =>
            (l.name && l.name.toLowerCase().includes(q)) ||
            (l.company && l.company.toLowerCase().includes(q)) ||
            (l.email && l.email.toLowerCase().includes(q)) ||
            (l.phone && l.phone.toLowerCase().includes(q)) ||
            (l.leadId && l.leadId.toLowerCase().includes(q))
        );
      }
    }

    const wb = XLSX.utils.book_new();

    const exportRows = leads.map((l, idx) => ({
      '#': idx + 1,
      'Lead ID': l.leadId || l.lead_id || `LD-${idx + 1}`,
      'Full Name': l.name || l.contactPerson || '',
      'Email': l.email || '',
      'Phone': l.phone || l.mobileNumber || '',
      'Company': l.company || '',
      'Job Title': l.jobTitle || '',
      'Lead Source': l.source || '',
      'Status': l.status || 'New',
      'Priority': l.priority || 'Medium',
      'Industry': l.industry || '',
      'Estimated Value (INR)': Number(l.estimatedValue || l.dealValue || 0),
      'Assigned To': l.assignedTo || l.assigned_to || 'Unassigned',
      'Assigned Manager': l.assignedManager || '',
      'City': l.city || '',
      'Country': l.country || 'India',
      'Requirement': l.requirement || '',
      'Created Date': l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-IN') : '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 22 },
      { wch: 30 },
      { wch: 18 },
      { wch: 26 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 35 },
      { wch: 16 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Leads Export');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Record export history
    const historyEntry = {
      id: 'exp_' + Date.now(),
      entityType: 'Lead',
      type: 'EXPORT',
      filename: `Leads_Export_${new Date().toISOString().slice(0, 10)}.xlsx`,
      recordsCount: exportRows.length,
      performedBy: req.user.name || req.user.username,
      performedById: req.user._id,
      timestamp: new Date().toISOString(),
      status: 'Completed',
    };

    if (!fallbackStore.importHistory) fallbackStore.importHistory = [];
    fallbackStore.importHistory.unshift(historyEntry);
    fallbackStore.saveToFile();

    await logAuditAction({
      entity_type: 'Lead',
      entity_id: 'EXCEL_EXPORT',
      action: 'EXPORT_EXCEL',
      operator: req.user,
      delta: `Exported ${exportRows.length} lead records to Excel (.xlsx)`,
      req,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Leads_Export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    console.error('Lead Excel export error:', err);
    return res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// @route   GET /api/leads/excel/history
// @desc    Get import/export history for Leads
// @access  Private
router.get('/excel/history', protect, async (req, res) => {
  try {
    const history = (fallbackStore.importHistory || []).filter((h) => h.entityType === 'Lead');
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch import history' });
  }
});

// @route   GET /api/leads
// @desc    Get all leads with role-based filtering, search, status, priority, manager, assignedTo, dates, and conversion status
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const {
      search,
      status,
      priority,
      source,
      assignedTo,
      manager,
      conversionStatus,
      startDate,
      endDate,
      followUpDate,
      sla_tier,
      disposition,
    } = req.query;

    const isSuperAdmin = req.user && req.user.role === 'Super Admin';

    if (fallbackStore.isFallback) {
      let filtered = [...(fallbackStore.leads || [])];
      const allUsers = fallbackStore.users || [];

      // Hierarchy filter: Super Admin gets all; Manager & User get self + subordinates + unassigned high priority
      if (!isSuperAdmin) {
        filtered = filtered.filter((lead) => canUserAccessLead(req.user, lead, allUsers));
      }

      if (assignedTo && assignedTo !== 'all') {
        filtered = filtered.filter((l) => (l.assignedTo && l.assignedTo.toLowerCase() === assignedTo.toLowerCase()) || (l.assignedSalesUser && l.assignedSalesUser.toLowerCase() === assignedTo.toLowerCase()));
      }

      if (manager && manager !== 'all') {
        filtered = filtered.filter((l) => (l.assignedManager && l.assignedManager.toLowerCase().includes(manager.toLowerCase())) || (l.assignedManagerName && l.assignedManagerName.toLowerCase().includes(manager.toLowerCase())));
      }

      if (conversionStatus && conversionStatus !== 'all') {
        if (conversionStatus === 'converted') {
          filtered = filtered.filter((l) => l.status === 'Converted' || !!l.opportunityId || !!l.convertedOpportunityId);
        } else if (conversionStatus === 'unconverted') {
          filtered = filtered.filter((l) => l.status !== 'Converted' && !l.opportunityId && !l.convertedOpportunityId);
        }
      }

      if (followUpDate && followUpDate !== 'all') {
        const targetDate = new Date(followUpDate).toISOString().split('T')[0];
        filtered = filtered.filter((l) => {
          if (!l.nextFollowUpDate && !l.next_followup_at) return false;
          const fDate = new Date(l.nextFollowUpDate || l.next_followup_at).toISOString().split('T')[0];
          return fDate === targetDate;
        });
      }

      if (startDate) {
        const start = new Date(startDate).getTime();
        filtered = filtered.filter((l) => new Date(l.createdAt).getTime() >= start);
      }
      if (endDate) {
        const end = new Date(endDate).getTime();
        filtered = filtered.filter((l) => new Date(l.createdAt).getTime() <= end);
      }

      if (sla_tier !== undefined && sla_tier !== 'all') {
        filtered = filtered.filter((l) => Number(l.sla_tier) === Number(sla_tier));
      }

      if (disposition && disposition !== 'all') {
        filtered = filtered.filter((l) => l.disposition_code === disposition);
      }

      // Search filter
      if (search && search.trim() !== '') {
        const query = search.trim().toLowerCase();
        filtered = filtered.filter(
          (l) =>
            (l.leadId && l.leadId.toLowerCase().includes(query)) ||
            (l.lead_id && l.lead_id.toLowerCase().includes(query)) ||
            (l.name && l.name.toLowerCase().includes(query)) ||
            (l.contactPerson && l.contactPerson.toLowerCase().includes(query)) ||
            (l.company && l.company.toLowerCase().includes(query)) ||
            (l.email && l.email.toLowerCase().includes(query)) ||
            (l.phone && l.phone.toLowerCase().includes(query)) ||
            (l.mobileNumber && l.mobileNumber.toLowerCase().includes(query)) ||
            (l.requirement && l.requirement.toLowerCase().includes(query)) ||
            (l.remarks && l.remarks.toLowerCase().includes(query)) ||
            (l.notes && l.notes.toLowerCase().includes(query)) ||
            (l.source && l.source.toLowerCase().includes(query)) ||
            (l.assignedTo && l.assignedTo.toLowerCase().includes(query)) ||
            (l.assignedSalesUser && l.assignedSalesUser.toLowerCase().includes(query))
        );
      }

      // Status filter
      if (status && status !== 'all') {
        filtered = filtered.filter((l) => l.status === status || (l.lead_status && l.lead_status.toUpperCase() === status.toUpperCase()));
      }

      // Priority filter
      if (priority && priority !== 'all') {
        filtered = filtered.filter((l) => l.priority === priority);
      }

      // Source filter
      if (source && source !== 'all') {
        filtered = filtered.filter((l) => (l.source && l.source.toLowerCase() === source.toLowerCase()) || (l.campaign_source && l.campaign_source.toLowerCase() === source.toLowerCase()));
      }

      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.json({
        success: true,
        count: filtered.length,
        roleScope: isSuperAdmin ? 'Full Organization Access' : (req.user?.role || 'User') === 'Manager' ? 'Manager & Subordinates Access' : 'Personal & Subordinates Access',
        leads: filtered,
      });
    } else {
      const queryObj = {};
      const andConditions = [];

      if (!isSuperAdmin) {
        const userName = req.user.name || '';
        const userUsername = req.user.username || '';
        const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
        const subordinateIdsSet = getSubordinateUserIds(req.user, allDbUsers);
        const subordinates = allDbUsers.filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));

        const subordinateNames = [
          ...subordinates.map((s) => s.name),
          ...subordinates.map((s) => s.username),
        ].filter(Boolean);
        const subordinateIds = Array.from(subordinateIdsSet);

        const names = [userName, userUsername, ...subordinateNames].filter(Boolean);
        andConditions.push({
          $or: [
            { assignedTo: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
            { assignedSalesUser: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
            { user: { $in: [req.user._id, ...subordinateIds] } },
            { assignedBy: new RegExp(escapeRegex(userName), 'i') },
            { is_high_priority_pool: true },
            { assignedTo: 'Unassigned (High-Priority Queue)' },
          ],
        });
      }

      if (assignedTo && assignedTo !== 'all') {
        andConditions.push({
          $or: [
            { assignedTo: new RegExp('^' + escapeRegex(assignedTo.trim()) + '$', 'i') },
            { assignedSalesUser: new RegExp('^' + escapeRegex(assignedTo.trim()) + '$', 'i') },
          ],
        });
      }

      if (manager && manager !== 'all') {
        queryObj.assignedManager = new RegExp(escapeRegex(manager.trim()), 'i');
      }

      if (conversionStatus && conversionStatus !== 'all') {
        if (conversionStatus === 'converted') {
          andConditions.push({
            $or: [{ status: 'Converted' }, { opportunityId: { $ne: null } }],
          });
        } else if (conversionStatus === 'unconverted') {
          queryObj.status = { $ne: 'Converted' };
          queryObj.opportunityId = null;
        }
      }

      if (followUpDate && followUpDate !== 'all') {
        const start = new Date(followUpDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(followUpDate);
        end.setHours(23, 59, 59, 999);
        queryObj.nextFollowUpDate = { $gte: start, $lte: end };
      }

      if (startDate || endDate) {
        queryObj.createdAt = {};
        if (startDate) queryObj.createdAt.$gte = new Date(startDate);
        if (endDate) queryObj.createdAt.$lte = new Date(endDate);
      }

      if (sla_tier !== undefined && sla_tier !== 'all') {
        queryObj.sla_tier = Number(sla_tier);
      }

      if (disposition && disposition !== 'all') {
        queryObj.disposition_code = disposition;
      }

      if (search && search.trim() !== '') {
        const regex = new RegExp(escapeRegex(search.trim()), 'i');
        const searchConditions = [
          { leadId: regex },
          { lead_id: regex },
          { name: regex },
          { contactPerson: regex },
          { company: regex },
          { email: regex },
          { phone: regex },
          { mobileNumber: regex },
          { requirement: regex },
          { remarks: regex },
          { notes: regex },
          { source: regex },
          { assignedTo: regex },
          { assignedSalesUser: regex },
        ];
        andConditions.push({ $or: searchConditions });
      }

      if (status && status !== 'all') {
        queryObj.status = status;
      }

      if (priority && priority !== 'all') {
        queryObj.priority = priority;
      }

      if (source && source !== 'all') {
        andConditions.push({
          $or: [
            { source: new RegExp('^' + escapeRegex(source.trim()) + '$', 'i') },
            { campaign_source: new RegExp('^' + escapeRegex(source.trim()) + '$', 'i') },
          ],
        });
      }

      if (andConditions.length > 0) {
        queryObj.$and = andConditions;
      }

      const leads = await Lead.find(queryObj).sort({ createdAt: -1 });

      return res.json({
        success: true,
        count: leads.length,
        roleScope: isSuperAdmin ? 'Full Organization Access' : (req.user?.role || 'User') === 'Manager' ? 'Manager & Subordinates Access' : 'Personal & Subordinates Access',
        leads,
      });
    }
  } catch (error) {
    console.error('Fetch leads error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leads',
      error: error.message,
    });
  }
});

// @route   GET /api/leads/stats
// @desc    Get complete MIS statistics & breakdown distributions for Leads
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';
    let userLeads = [];

    if (fallbackStore.isFallback) {
      const allLeads = fallbackStore.leads || [];
      const allUsers = fallbackStore.users || [];
      if (isSuperAdmin) {
        userLeads = allLeads;
      } else {
        userLeads = allLeads.filter((l) => canUserAccessLead(req.user, l, allUsers));
      }
    } else {
      if (isSuperAdmin) {
        userLeads = await Lead.find({});
      } else {
        const userName = req.user.name || '';
        const userUsername = req.user.username || '';
        const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
        const subordinateIdsSet = getSubordinateUserIds(req.user, allDbUsers);
        const subordinates = allDbUsers.filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));

        const subordinateNames = [
          ...subordinates.map((s) => s.name),
          ...subordinates.map((s) => s.username),
        ].filter(Boolean);
        const subordinateIds = Array.from(subordinateIdsSet);

        const names = [userName, userUsername, ...subordinateNames].filter(Boolean);
        userLeads = await Lead.find({
          $or: [
            { assignedTo: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
            { assignedSalesUser: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
            { user: { $in: [req.user._id, ...subordinateIds] } },
            { assignedBy: new RegExp(escapeRegex(userName), 'i') },
            { is_high_priority_pool: true },
          ],
        });
      }
    }

    const totalLeads = userLeads.length;
    const newLeads = userLeads.filter((l) => l.status === 'New' || l.lead_status === 'NEW').length;
    const contactedLeads = userLeads.filter((l) => l.status === 'Contacted').length;
    const followUpLeads = userLeads.filter((l) => l.status === 'Follow-Up' || l.status === 'Follow_Up').length;
    const qualifiedLeads = userLeads.filter((l) => l.status === 'Qualified').length;
    const interestedLeads = userLeads.filter((l) => l.status === 'Interested').length;
    const convertedLeads = userLeads.filter((l) => l.status === 'Converted' || l.lead_status === 'CONVERTED' || !!l.opportunityId).length;
    const notInterestedLeads = userLeads.filter((l) => l.status === 'Not Interested' || l.disposition_code === 'NOT_INTERESTED').length;
    const invalidLeads = userLeads.filter((l) => l.status === 'Invalid').length;

    // Follow-Ups stats
    const now = new Date();
    let pendingFollowUps = 0;
    let overdueFollowUps = 0;
    const followUpsByUserMap = {};

    userLeads.forEach((lead) => {
      const flws = Array.isArray(lead.followups) ? lead.followups : [];
      flws.forEach((f) => {
        if (f.status === 'Pending') {
          pendingFollowUps++;
          if (f.followUpDate && new Date(f.followUpDate) < now) {
            overdueFollowUps++;
          }
        }
        const user = f.assignedTo || lead.assignedTo || 'Unassigned';
        followUpsByUserMap[user] = (followUpsByUserMap[user] || 0) + 1;
      });
    });

    // Call stats
    let totalCallAttempts = 0;
    let connectedCalls = 0;
    let noAnswerCalls = 0;
    let callbackRequestedCalls = 0;
    const callsByUserMap = {};

    userLeads.forEach((lead) => {
      const calls = Array.isArray(lead.callLogs) ? lead.callLogs : [];
      totalCallAttempts += calls.length;
      calls.forEach((c) => {
        if (c.callStatus === 'Connected Successfully') connectedCalls++;
        if (c.callStatus === 'No Answer') noAnswerCalls++;
        if (c.callStatus === 'Call Back Requested') callbackRequestedCalls++;

        const user = c.salesUser || lead.assignedTo || 'Sales Team';
        callsByUserMap[user] = (callsByUserMap[user] || 0) + 1;
      });
    });

    // Conversion rate: Converted Leads / Total Leads * 100
    const conversionRate = totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0;

    // Leads by Sales User
    const salesUserMap = {};
    const managerMap = {};
    const sourceMap = {};
    const conversionByUserMap = {};
    const conversionByMonthMap = {};

    userLeads.forEach((lead) => {
      const sUser = lead.assignedSalesUser || lead.assignedTo || 'Unassigned';
      if (!salesUserMap[sUser]) salesUserMap[sUser] = { count: 0, value: 0 };
      salesUserMap[sUser].count += 1;
      salesUserMap[sUser].value += Number(lead.estimatedValue || lead.dealValue || 0);

      const mgr = lead.assignedManagerName || lead.assignedManager || 'General Management';
      if (!managerMap[mgr]) managerMap[mgr] = { count: 0, value: 0 };
      managerMap[mgr].count += 1;
      managerMap[mgr].value += Number(lead.estimatedValue || lead.dealValue || 0);

      const src = lead.source || lead.campaign_source || 'Website';
      sourceMap[src] = (sourceMap[src] || 0) + 1;

      if (lead.status === 'Converted' || lead.opportunityId) {
        if (!conversionByUserMap[sUser]) conversionByUserMap[sUser] = { count: 0, value: 0 };
        conversionByUserMap[sUser].count += 1;
        conversionByUserMap[sUser].value += Number(lead.estimatedValue || lead.dealValue || 0);

        const convDate = lead.convertedAt ? new Date(lead.convertedAt) : new Date(lead.createdAt);
        const monthKey = convDate.toLocaleString('default', { month: 'short', year: 'numeric' });
        if (!conversionByMonthMap[monthKey]) conversionByMonthMap[monthKey] = { count: 0, value: 0 };
        conversionByMonthMap[monthKey].count += 1;
        conversionByMonthMap[monthKey].value += Number(lead.estimatedValue || lead.dealValue || 0);
      }
    });

    const leadsBySalesUser = Object.keys(salesUserMap).map((k) => ({ user: k, ...salesUserMap[k] }));
    const leadsByManager = Object.keys(managerMap).map((k) => ({ manager: k, ...managerMap[k] }));
    const leadsBySource = Object.keys(sourceMap).map((k) => ({ source: k, count: sourceMap[k] }));
    const callsByUser = Object.keys(callsByUserMap).map((k) => ({ user: k, count: callsByUserMap[k] }));
    const followUpsByUser = Object.keys(followUpsByUserMap).map((k) => ({ user: k, count: followUpsByUserMap[k] }));
    const conversionByUser = Object.keys(conversionByUserMap).map((k) => ({ user: k, ...conversionByUserMap[k] }));
    const conversionByMonth = Object.keys(conversionByMonthMap).map((k) => ({ month: k, ...conversionByMonthMap[k] }));

    res.json({
      success: true,
      stats: {
        total: totalLeads,
        totalLeads,
        newLeads,
        contacted: contactedLeads,
        contactedLeads,
        followUpLeads,
        qualified: qualifiedLeads,
        qualifiedLeads,
        interestedLeads,
        converted: convertedLeads,
        convertedLeads,
        notInterestedLeads,
        invalidLeads,
        pendingFollowUps,
        overdueFollowUps,
        totalCallAttempts,
        connectedCalls,
        noAnswerCalls,
        callbackRequestedCalls,
        conversionRate,
        leadsBySalesUser,
        leadsByManager,
        leadsBySource,
        callsByUser,
        followUpsByUser,
        conversionByUser,
        conversionByMonth,
      },
    });
  } catch (error) {
    console.error('Lead stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve lead statistics',
      error: error.message,
    });
  }
});

// @route   GET /api/leads/:id
// @desc    Get single lead with complete call history, follow-ups, and timeline journey
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    let lead = null;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      lead = (fallbackStore.leads || []).find((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
    } else {
      allUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      lead = await Lead.findById(id);
      if (!lead) {
        lead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      }
    }

    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    // Authorization check
    if (!canUserAccessLead(req.user, lead, allUsers)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to access this lead',
      });
    }

    return res.json({ success: true, lead });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch lead', error: error.message });
  }
});

// @route   POST /api/leads
// @desc    Create a new lead with all required fields, timeline event, and human-readable leadId
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const {
      name,
      contactPerson,
      company,
      phone,
      mobileNumber,
      email,
      source = 'Website',
      requirement = '',
      status = 'New',
      priority = 'Medium',
      estimatedValue = 0,
      dealValue = 0,
      assignedSalesUser,
      assignedTo,
      assignedManager = '',
      assignedManagerName = '',
      remarks = '',
      notes = '',
      nextFollowUpDate,
      nextFollowUpTime,
    } = req.body;

    const leadName = (contactPerson || name || '').trim();
    if (!leadName) {
      return res.status(400).json({ success: false, message: 'Lead Name / Contact Person is required' });
    }

    // Email uniqueness check
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (normalizedEmail) {
      let duplicateLead = null;
      if (fallbackStore.isFallback) {
        duplicateLead = (fallbackStore.leads || []).find(
          (l) => l.email && l.email.trim().toLowerCase() === normalizedEmail && !l.is_deleted
        );
      } else {
        duplicateLead = await Lead.findOne({
          email: { $regex: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          is_deleted: { $ne: true },
        });
      }

      if (duplicateLead) {
        return res.status(400).json({
          success: false,
          message: `This email already exists (${normalizedEmail}). Lead emails must be unique.`,
        });
      }
    }

    const targetAssignedTo = (assignedSalesUser || assignedTo || req.user?.name || 'Current User').trim();

    // Validate organizational hierarchy assignment
    const hierarchyCheck = await validateHierarchyAssignment(req.user, targetAssignedTo);
    if (!hierarchyCheck.valid) {
      return res.status(400).json({
        success: false,
        message: hierarchyCheck.message,
      });
    }

    const assignedBy = `${req.user?.name || 'User'} (${req.user?.role || 'User'})`;
    let targetUserId = hierarchyCheck.targetUser?._id || null;
    const assignerIdStr = req.user?._id ? (req.user._id.toString ? req.user._id.toString() : req.user._id) : undefined;

    const pValue = Number(estimatedValue) || Number(dealValue) || 0;
    const leadPhone = (mobileNumber || phone || '').trim();
    const leadNotes = (remarks || notes || '').trim();
    const readableLeadId = await generateNextLeadId();

    const initialTimeline = [
      {
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'LEAD_CREATED',
        title: 'Lead Created',
        description: `New lead created from ${source || 'Website'} for ${(company || leadName).trim()}.`,
        author: req.user?.name || 'System',
        authorId: req.user?._id?.toString() || '',
        timestamp: new Date(),
      },
    ];

    const initialFollowups = [];
    if (nextFollowUpDate) {
      initialFollowups.push({
        followUpId: 'FLW-' + Math.floor(1000 + Math.random() * 9000),
        followUpDate: new Date(nextFollowUpDate),
        followUpTime: nextFollowUpTime || '',
        reason: 'Initial follow-up scheduled upon lead creation',
        assignedTo: targetAssignedTo,
        remarks: leadNotes,
        status: 'Pending',
        createdAt: new Date(),
      });
    }

    const newLeadData = {
      lead_id: 'lead_' + crypto.randomUUID(),
      leadId: readableLeadId,
      name: leadName,
      contactPerson: leadName,
      company: (company || '').trim(),
      phone: leadPhone,
      mobileNumber: leadPhone,
      email: (email || '').trim().toLowerCase(),
      source: (source || 'Website').trim(),
      requirement: (requirement || '').trim(),
      status: status || 'New',
      lead_status: (status || 'New').toUpperCase() === 'NEW' ? 'NEW' : 'IN_PROGRESS',
      priority: priority || 'Medium',
      estimatedValue: pValue,
      dealValue: pValue,
      pipeline_value: pValue,
      assignedTo: targetAssignedTo,
      assignedSalesUser: targetAssignedTo,
      assignedManager: assignedManager || '',
      assignedManagerName: assignedManagerName || assignedManager || '',
      assignedBy,
      assignedById: assignerIdStr,
      user: targetUserId,
      remarks: leadNotes,
      notes: leadNotes,
      lastContactDate: null,
      nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
      nextFollowUpTime: nextFollowUpTime || '',
      next_followup_at: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
      callLogs: [],
      followups: initialFollowups,
      timeline: initialTimeline,
      opportunityId: null,
      convertedOpportunityId: null,
      convertedAt: null,
      convertedBy: null,
      convertedByName: '',
      sla_tier: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const generatedId = '64e8d1' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      const createdLead = { _id: generatedId, ...newLeadData };
      if (!fallbackStore.leads) fallbackStore.leads = [];
      fallbackStore.leads.unshift(createdLead);
      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: createdLead._id,
        action: 'CREATE',
        operator: req.user,
        updated_state: createdLead,
        delta: `Created lead ${createdLead.leadId} "${createdLead.name}" (${createdLead.company || 'Enterprise'})`,
        req,
      });

      // Dispatch instant notification to assigned user
      await createLeadAssignmentNotification({
        lead: createdLead,
        targetAssignedTo,
        targetUserId,
        assignerUser: req.user,
        io,
      });

      return res.status(201).json({
        success: true,
        message: 'Lead created successfully',
        lead: createdLead,
      });
    } else {
      const lead = await Lead.create(newLeadData);

      try {
        if (!fallbackStore.leads) fallbackStore.leads = [];
        fallbackStore.leads.unshift(lead.toObject());
        fallbackStore.saveToFile();
      } catch (err) {
        console.warn('Local lead backup notice:', err.message);
      }

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: lead._id,
        action: 'CREATE',
        operator: req.user,
        updated_state: lead.toObject(),
        delta: `Created lead ${lead.leadId} "${lead.name}" (${lead.company || 'Enterprise'})`,
        req,
      });

      // Dispatch instant notification to assigned user
      await createLeadAssignmentNotification({
        lead: lead.toObject ? lead.toObject() : lead,
        targetAssignedTo,
        targetUserId,
        assignerUser: req.user,
        io,
      });

      return res.status(201).json({
        success: true,
        message: 'Lead created successfully',
        lead,
      });
    }
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create lead',
      error: error.message,
    });
  }
});

// @route   PUT /api/leads/:id
// @desc    Edit and update full lead details with role authorization & audit trail
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      contactPerson,
      company,
      phone,
      mobileNumber,
      email,
      source,
      requirement,
      status,
      priority,
      estimatedValue,
      dealValue,
      assignedSalesUser,
      assignedTo,
      assignedManager,
      assignedManagerName,
      remarks,
      notes,
      nextFollowUpDate,
      nextFollowUpTime,
    } = req.body;

    const leadName = contactPerson !== undefined ? contactPerson.trim() : name !== undefined ? name.trim() : undefined;
    if (leadName !== undefined && !leadName) {
      return res.status(400).json({ success: false, message: 'Lead contact name cannot be empty' });
    }

    const assignedTarget = assignedSalesUser || assignedTo;
    let targetUserId = undefined;
    if (assignedTarget && assignedTarget.trim()) {
      const hierarchyCheck = await validateHierarchyAssignment(req.user, assignedTarget.trim());
      if (!hierarchyCheck.valid) {
        return res.status(400).json({
          success: false,
          message: hierarchyCheck.message,
        });
      }
      if (hierarchyCheck.targetUser) targetUserId = hierarchyCheck.targetUser._id;
    }

    const io = req.app.get('io');
    const pVal = estimatedValue !== undefined ? Number(estimatedValue) : dealValue !== undefined ? Number(dealValue) : undefined;
    const leadPhone = mobileNumber !== undefined ? mobileNumber.trim() : phone !== undefined ? phone.trim() : undefined;
    const leadRemarks = remarks !== undefined ? remarks.trim() : notes !== undefined ? notes.trim() : undefined;

    // Check duplicate email on update if email is provided
    const normalizedEmail = email !== undefined ? email.trim().toLowerCase() : undefined;
    if (normalizedEmail) {
      let duplicateLead = null;
      if (fallbackStore.isFallback) {
        duplicateLead = (fallbackStore.leads || []).find(
          (l) =>
            l.email &&
            l.email.trim().toLowerCase() === normalizedEmail &&
            l._id.toString() !== id.toString() &&
            l.lead_id !== id &&
            l.leadId !== id &&
            !l.is_deleted
        );
      } else {
        duplicateLead = await Lead.findOne({
          email: { $regex: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          _id: { $ne: id },
          lead_id: { $ne: id },
          leadId: { $ne: id },
          is_deleted: { $ne: true },
        });
      }

      if (duplicateLead) {
        return res.status(400).json({
          success: false,
          message: `This email already exists (${normalizedEmail}). Lead emails must be unique.`,
        });
      }
    }

    if (fallbackStore.isFallback) {
      const leadIndex = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (leadIndex === -1) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }

      const existing = fallbackStore.leads[leadIndex];
      const priorState = { ...existing };

      if (!canUserAccessLead(req.user, existing, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to modify this lead',
        });
      }

      // Check status transition
      let timeline = Array.isArray(existing.timeline) ? [...existing.timeline] : [];
      if (status && status !== existing.status) {
        timeline.push({
          eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
          eventType: 'STATUS_CHANGED',
          title: `Status Changed: ${status}`,
          description: `Lead status updated from ${existing.status} to ${status}.`,
          author: req.user?.name || 'System',
          timestamp: new Date(),
        });
      }

      const updated = {
        ...existing,
        name: leadName !== undefined ? leadName : existing.name,
        contactPerson: leadName !== undefined ? leadName : existing.contactPerson || existing.name,
        company: company !== undefined ? company.trim() : existing.company,
        phone: leadPhone !== undefined ? leadPhone : existing.phone,
        mobileNumber: leadPhone !== undefined ? leadPhone : existing.mobileNumber || existing.phone,
        email: email !== undefined ? email.trim().toLowerCase() : existing.email,
        source: source !== undefined ? source.trim() : existing.source,
        requirement: requirement !== undefined ? requirement.trim() : existing.requirement || '',
        status: status || existing.status,
        lead_status: status ? (status.toUpperCase() === 'NEW' ? 'NEW' : status.toUpperCase() === 'LOST' ? 'LOST' : 'IN_PROGRESS') : existing.lead_status,
        priority: priority || existing.priority,
        estimatedValue: pVal !== undefined ? pVal : existing.estimatedValue || existing.dealValue || 0,
        dealValue: pVal !== undefined ? pVal : existing.dealValue || existing.estimatedValue || 0,
        pipeline_value: pVal !== undefined ? pVal : existing.pipeline_value || existing.dealValue || 0,
        assignedTo: assignedTarget !== undefined ? assignedTarget.trim() : existing.assignedTo,
        assignedSalesUser: assignedTarget !== undefined ? assignedTarget.trim() : existing.assignedSalesUser || existing.assignedTo,
        assignedManager: assignedManager !== undefined ? assignedManager.trim() : existing.assignedManager || '',
        assignedManagerName: assignedManagerName !== undefined ? assignedManagerName.trim() : existing.assignedManagerName || existing.assignedManager || '',
        user: targetUserId !== undefined ? targetUserId : existing.user,
        remarks: leadRemarks !== undefined ? leadRemarks : existing.remarks || existing.notes || '',
        notes: leadRemarks !== undefined ? leadRemarks : existing.notes || existing.remarks || '',
        nextFollowUpDate: nextFollowUpDate !== undefined ? (nextFollowUpDate ? new Date(nextFollowUpDate) : null) : existing.nextFollowUpDate,
        nextFollowUpTime: nextFollowUpTime !== undefined ? nextFollowUpTime : existing.nextFollowUpTime || '',
        next_followup_at: nextFollowUpDate !== undefined ? (nextFollowUpDate ? new Date(nextFollowUpDate) : null) : existing.next_followup_at,
        timeline,
        updatedAt: new Date(),
      };

      fallbackStore.leads[leadIndex] = updated;
      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: updated._id,
        action: 'UPDATE',
        operator: req.user,
        prior_state: priorState,
        updated_state: updated,
        delta: `Updated lead details for ${updated.leadId || ''} "${updated.name}"`,
        req,
      });

      if (
        assignedTarget !== undefined &&
        assignedTarget.trim() &&
        assignedTarget.trim().toLowerCase() !== (priorState.assignedTo || '').trim().toLowerCase()
      ) {
        await createLeadAssignmentNotification({
          lead: updated,
          targetAssignedTo: assignedTarget.trim(),
          targetUserId,
          assignerUser: req.user,
          isReassignment: true,
          io,
        });
      } else if (io) {
        io.emit('leads:updated', { lead: updated, action: 'updated' });
      }

      return res.json({
        success: true,
        message: 'Lead updated successfully',
        lead: updated,
      });
    } else {
      let lead = await Lead.findById(id);
      if (!lead) {
        lead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      }
      if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, lead, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to modify this lead',
        });
      }

      const priorState = lead.toObject();

      if (status && status !== lead.status) {
        lead.timeline.push({
          eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
          eventType: 'STATUS_CHANGED',
          title: `Status Changed: ${status}`,
          description: `Lead status updated from ${lead.status} to ${status}.`,
          author: req.user?.name || 'System',
          timestamp: new Date(),
        });
      }

      if (leadName !== undefined) {
        lead.name = leadName;
        lead.contactPerson = leadName;
      }
      if (company !== undefined) lead.company = company.trim();
      if (leadPhone !== undefined) {
        lead.phone = leadPhone;
        lead.mobileNumber = leadPhone;
      }
      if (email !== undefined) lead.email = email.trim().toLowerCase();
      if (source !== undefined) lead.source = source.trim();
      if (requirement !== undefined) lead.requirement = requirement.trim();
      if (status) {
        lead.status = status;
        lead.lead_status = status.toUpperCase() === 'NEW' ? 'NEW' : status.toUpperCase() === 'LOST' ? 'LOST' : 'IN_PROGRESS';
      }
      if (priority) lead.priority = priority;
      if (pVal !== undefined) {
        lead.estimatedValue = pVal;
        lead.dealValue = pVal;
        lead.pipeline_value = pVal;
      }
      if (assignedTarget !== undefined) {
        lead.assignedTo = assignedTarget.trim();
        lead.assignedSalesUser = assignedTarget.trim();
        if (targetUserId) lead.user = targetUserId;
      }
      if (assignedManager !== undefined) lead.assignedManager = assignedManager.trim();
      if (assignedManagerName !== undefined) lead.assignedManagerName = assignedManagerName.trim();
      if (leadRemarks !== undefined) {
        lead.remarks = leadRemarks;
        lead.notes = leadRemarks;
      }
      if (nextFollowUpDate !== undefined) {
        lead.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
        lead.next_followup_at = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
      }
      if (nextFollowUpTime !== undefined) lead.nextFollowUpTime = nextFollowUpTime;
      lead.updatedAt = new Date();

      await lead.save();

      try {
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === lead._id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = lead.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {}

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: lead._id,
        action: 'UPDATE',
        operator: req.user,
        prior_state: priorState,
        updated_state: lead.toObject(),
        delta: `Updated lead details for ${lead.leadId || ''} "${lead.name}"`,
        req,
      });

      if (
        assignedTarget !== undefined &&
        assignedTarget.trim() &&
        assignedTarget.trim().toLowerCase() !== (priorState.assignedTo || '').trim().toLowerCase()
      ) {
        await createLeadAssignmentNotification({
          lead: lead.toObject ? lead.toObject() : lead,
          targetAssignedTo: assignedTarget.trim(),
          targetUserId,
          assignerUser: req.user,
          isReassignment: true,
          io,
        });
      } else if (io) {
        io.emit('leads:updated', { lead, action: 'updated' });
      }

      return res.json({
        success: true,
        message: 'Lead updated successfully',
        lead,
      });
    }
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update lead',
      error: error.message,
    });
  }
});

// @route   PATCH /api/leads/:id/status
// @desc    Update lead status directly with timeline tracking & audit log
// @access  Private
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks = '', notes = '' } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const io = req.app.get('io');
    let targetLead = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.leads || []).findIndex(
        (l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id
      );
      if (idx === -1) return res.status(404).json({ success: false, message: 'Lead not found' });

      targetLead = fallbackStore.leads[idx];
      const priorState = { ...targetLead };

      if (!canUserAccessLead(req.user, targetLead, fallbackStore.users || [])) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to update this lead' });
      }

      if (targetLead.status === 'Converted' && status !== 'Converted') {
        return res.status(400).json({
          success: false,
          message: 'Lead is already converted to an Opportunity and its status cannot be reverted.',
        });
      }

      const prevStatus = targetLead.status;
      targetLead.status = status;
      targetLead.lead_status =
        status.toUpperCase() === 'NEW'
          ? 'NEW'
          : status.toUpperCase() === 'LOST'
          ? 'LOST'
          : status.toUpperCase() === 'CONVERTED'
          ? 'CONVERTED'
          : 'IN_PROGRESS';
      targetLead.stage_entered_at = new Date();
      targetLead.days_in_stage = 0;
      targetLead.updatedAt = new Date();

      if (remarks || notes) {
        targetLead.remarks = (remarks || notes).trim();
        targetLead.notes = (notes || remarks).trim();
      }

      if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'STATUS_CHANGED',
        title: status === 'Qualified' ? 'Lead Qualified' : `Status Changed: ${status}`,
        description: `Status changed from ${prevStatus} to ${status}.${remarks ? ` Note: ${remarks}` : ''}`,
        author: req.user?.name || 'System',
        authorId: req.user?._id?.toString() || '',
        timestamp: new Date(),
      });

      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'UPDATE',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead,
        delta: `Updated status from ${prevStatus} to ${status}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'status_updated' });
      }

      return res.json({
        success: true,
        message: `Lead status updated to ${status}`,
        lead: targetLead,
      });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) {
        targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      }
      if (!targetLead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, targetLead, allDbUsers)) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to update this lead' });
      }

      if (targetLead.status === 'Converted' && status !== 'Converted') {
        return res.status(400).json({
          success: false,
          message: 'Lead is already converted to an Opportunity and its status cannot be reverted.',
        });
      }

      const priorState = targetLead.toObject();
      const prevStatus = targetLead.status;
      targetLead.status = status;
      targetLead.lead_status =
        status.toUpperCase() === 'NEW'
          ? 'NEW'
          : status.toUpperCase() === 'LOST'
          ? 'LOST'
          : status.toUpperCase() === 'CONVERTED'
          ? 'CONVERTED'
          : 'IN_PROGRESS';
      targetLead.stage_entered_at = new Date();
      targetLead.days_in_stage = 0;
      targetLead.updatedAt = new Date();

      if (remarks || notes) {
        targetLead.remarks = (remarks || notes).trim();
        targetLead.notes = (notes || remarks).trim();
      }

      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'STATUS_CHANGED',
        title: status === 'Qualified' ? 'Lead Qualified' : `Status Changed: ${status}`,
        description: `Status changed from ${prevStatus} to ${status}.${remarks ? ` Note: ${remarks}` : ''}`,
        author: req.user?.name || 'System',
        authorId: req.user?._id?.toString() || '',
        timestamp: new Date(),
      });

      await targetLead.save();

      try {
        const localIdx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === targetLead._id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = targetLead.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {}

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'UPDATE',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead.toObject(),
        delta: `Updated status from ${prevStatus} to ${status}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'status_updated' });
      }

      return res.json({
        success: true,
        message: `Lead status updated to ${status}`,
        lead: targetLead,
      });
    }
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update lead status',
      error: error.message,
    });
  }
});

// @route   POST /api/leads/:id/qualify
// @desc    Qualify a lead without automatically converting to Opportunity
// @access  Private
router.post('/:id/qualify', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      requirement = '',
      estimatedValue = '',
      dealValue = '',
      expectedCloseDate = '',
      nextFollowUpDate = '',
      remarks = '',
      notes = '',
    } = req.body;

    const io = req.app.get('io');
    let targetLead = null;

    const val = Number(estimatedValue || dealValue) || 0;
    const fDate = nextFollowUpDate || expectedCloseDate || null;
    const rem = (remarks || notes || '').trim();
    const reqDetails = (requirement || '').trim();

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.leads || []).findIndex(
        (l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id
      );
      if (idx === -1) return res.status(404).json({ success: false, message: 'Lead not found' });

      targetLead = fallbackStore.leads[idx];
      const priorState = { ...targetLead };

      if (!canUserAccessLead(req.user, targetLead, fallbackStore.users || [])) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to qualify this lead' });
      }

      if (targetLead.status === 'Converted' || targetLead.opportunityId) {
        return res.status(400).json({
          success: false,
          message: 'Lead is already converted to an Opportunity.',
        });
      }

      targetLead.status = 'Qualified';
      targetLead.lead_status = 'IN_PROGRESS';
      targetLead.stage_entered_at = new Date();
      targetLead.days_in_stage = 0;
      targetLead.updatedAt = new Date();

      if (reqDetails) targetLead.requirement = reqDetails;
      if (val > 0) {
        targetLead.estimatedValue = val;
        targetLead.dealValue = val;
        targetLead.pipeline_value = val;
      }
      if (fDate) {
        targetLead.nextFollowUpDate = new Date(fDate);
        targetLead.next_followup_at = new Date(fDate);
      }
      if (rem) {
        targetLead.remarks = rem;
        targetLead.notes = rem;
      }

      if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'STATUS_CHANGED',
        title: 'Lead Qualified',
        description: `Lead verified and marked as Qualified for opportunity pipeline.${val > 0 ? ` Estimated Deal Value: ₹${val.toLocaleString()}` : ''}${rem ? ` [${rem}]` : ''}`,
        author: req.user?.name || 'System',
        authorId: req.user?._id?.toString() || '',
        timestamp: new Date(),
      });

      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'UPDATE',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead,
        delta: `Qualified lead ${targetLead.leadId}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'qualified' });
      }

      return res.json({
        success: true,
        message: `Lead ${targetLead.leadId || ''} successfully marked as Qualified`,
        lead: targetLead,
      });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) {
        targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      }
      if (!targetLead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, targetLead, allDbUsers)) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to qualify this lead' });
      }

      if (targetLead.status === 'Converted' || targetLead.opportunityId) {
        return res.status(400).json({
          success: false,
          message: 'Lead is already converted to an Opportunity.',
        });
      }

      const priorState = targetLead.toObject();
      targetLead.status = 'Qualified';
      targetLead.lead_status = 'IN_PROGRESS';
      targetLead.stage_entered_at = new Date();
      targetLead.days_in_stage = 0;
      targetLead.updatedAt = new Date();

      if (reqDetails) targetLead.requirement = reqDetails;
      if (val > 0) {
        targetLead.estimatedValue = val;
        targetLead.dealValue = val;
        targetLead.pipeline_value = val;
      }
      if (fDate) {
        targetLead.nextFollowUpDate = new Date(fDate);
        targetLead.next_followup_at = new Date(fDate);
      }
      if (rem) {
        targetLead.remarks = rem;
        targetLead.notes = rem;
      }

      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'STATUS_CHANGED',
        title: 'Lead Qualified',
        description: `Lead verified and marked as Qualified for opportunity pipeline.${val > 0 ? ` Estimated Deal Value: ₹${val.toLocaleString()}` : ''}${rem ? ` [${rem}]` : ''}`,
        author: req.user?.name || 'System',
        authorId: req.user?._id?.toString() || '',
        timestamp: new Date(),
      });

      await targetLead.save();

      try {
        const localIdx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === targetLead._id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = targetLead.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {}

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'UPDATE',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead.toObject(),
        delta: `Qualified lead ${targetLead.leadId}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'qualified' });
      }

      return res.json({
        success: true,
        message: `Lead ${targetLead.leadId || ''} successfully marked as Qualified`,
        lead: targetLead,
      });
    }
  } catch (error) {
    console.error('Qualify lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to qualify lead',
      error: error.message,
    });
  }
});

// @route   POST /api/leads/:id/calls
// @desc    Record communication/call interaction history for a lead
// @access  Private
router.post('/:id/calls', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      salesUser = req.user?.name || 'Sales Representative',
      date = new Date().toISOString().split('T')[0],
      time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      callType = 'Outgoing',
      callStatus = 'Connected Successfully',
      duration = '',
      callOutcome = 'Interested',
      leadResponse = '',
      remarks = '',
      nextAction = '',
      nextFollowUpDate = '',
      nextFollowUpTime = '',
      updateStatus = '',
    } = req.body;

    const io = req.app.get('io');
    let targetLead = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (idx === -1) return res.status(404).json({ success: false, message: 'Lead not found' });

      targetLead = fallbackStore.leads[idx];
      if (!canUserAccessLead(req.user, targetLead, fallbackStore.users || [])) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to add call log' });
      }

      const activityId = 'ACT-' + Math.floor(1000 + Math.random() * 9000);
      const newCallLog = {
        activityId,
        leadId: targetLead.leadId || targetLead.lead_id || '',
        salesUser: salesUser.trim(),
        salesUserId: req.user?._id?.toString() || '',
        date,
        time,
        callType,
        callStatus,
        duration: duration ? duration.trim() : '',
        callOutcome,
        leadResponse: leadResponse ? leadResponse.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        nextAction: nextAction ? nextAction.trim() : '',
        nextFollowUpDate: nextFollowUpDate || '',
        nextFollowUpTime: nextFollowUpTime || '',
        timestamp: new Date(),
      };

      if (!Array.isArray(targetLead.callLogs)) targetLead.callLogs = [];
      targetLead.callLogs.push(newCallLog);

      targetLead.lastContactDate = new Date();
      targetLead.last_contacted_at = new Date();

      if (nextFollowUpDate) {
        targetLead.nextFollowUpDate = new Date(nextFollowUpDate);
        targetLead.next_followup_at = new Date(nextFollowUpDate);
        targetLead.nextFollowUpTime = nextFollowUpTime || '';

        // Auto-create Follow-Up entry
        if (!Array.isArray(targetLead.followups)) targetLead.followups = [];
        targetLead.followups.push({
          followUpId: 'FLW-' + Math.floor(1000 + Math.random() * 9000),
          followUpDate: new Date(nextFollowUpDate),
          followUpTime: nextFollowUpTime || '',
          reason: leadResponse || nextAction || `Follow-up from call (${callOutcome})`,
          assignedTo: salesUser.trim(),
          remarks: remarks || leadResponse || '',
          status: 'Pending',
          createdAt: new Date(),
        });
      }

      // Status transition logic based on outcome/parameter
      if (updateStatus && VALID_STATUSES.includes(updateStatus) && targetLead.status !== 'Converted') {
        targetLead.status = updateStatus;
      } else if (callOutcome === 'Interested' && targetLead.status !== 'Converted') {
        targetLead.status = 'Interested';
      } else if (callOutcome === 'Qualified' && targetLead.status !== 'Converted') {
        targetLead.status = 'Qualified';
      } else if (callOutcome === 'Not Interested' && targetLead.status !== 'Converted') {
        targetLead.status = 'Not Interested';
      } else if (targetLead.status === 'New') {
        targetLead.status = 'Contacted';
      }

      // Add to Visual Timeline
      if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'CALL_LOGGED',
        title: `${callType} Call — ${callStatus}${callOutcome ? ` (${callOutcome})` : ''}`,
        description: `${salesUser}: ${leadResponse ? `"${leadResponse}" ` : ''}${remarks ? `[${remarks}] ` : ''}${nextAction ? `Next Action: ${nextAction}` : ''}`,
        author: salesUser,
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'CALL_LOGGED',
        operator: req.user,
        updated_state: targetLead,
        delta: `Logged ${callType} call (${callStatus}, ${callOutcome}) for ${targetLead.leadId}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'call_logged' });
      }

      return res.status(201).json({
        success: true,
        message: 'Communication call log recorded successfully',
        callLog: newCallLog,
        lead: targetLead,
      });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) {
        targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      }
      if (!targetLead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, targetLead, allDbUsers)) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to add call log' });
      }

      const activityId = 'ACT-' + Math.floor(1000 + Math.random() * 9000);
      const newCallLog = {
        activityId,
        leadId: targetLead.leadId || targetLead.lead_id || '',
        salesUser: salesUser.trim(),
        salesUserId: req.user?._id?.toString() || '',
        date,
        time,
        callType,
        callStatus,
        duration: duration ? duration.trim() : '',
        callOutcome,
        leadResponse: leadResponse ? leadResponse.trim() : '',
        remarks: remarks ? remarks.trim() : '',
        nextAction: nextAction ? nextAction.trim() : '',
        nextFollowUpDate: nextFollowUpDate || '',
        nextFollowUpTime: nextFollowUpTime || '',
        timestamp: new Date(),
      };

      targetLead.callLogs.push(newCallLog);
      targetLead.lastContactDate = new Date();
      targetLead.last_contacted_at = new Date();

      if (nextFollowUpDate) {
        targetLead.nextFollowUpDate = new Date(nextFollowUpDate);
        targetLead.next_followup_at = new Date(nextFollowUpDate);
        targetLead.nextFollowUpTime = nextFollowUpTime || '';

        targetLead.followups.push({
          followUpId: 'FLW-' + Math.floor(1000 + Math.random() * 9000),
          followUpDate: new Date(nextFollowUpDate),
          followUpTime: nextFollowUpTime || '',
          reason: leadResponse || nextAction || `Follow-up from call (${callOutcome})`,
          assignedTo: salesUser.trim(),
          remarks: remarks || leadResponse || '',
          status: 'Pending',
          createdAt: new Date(),
        });
      }

      if (updateStatus && VALID_STATUSES.includes(updateStatus) && targetLead.status !== 'Converted') {
        targetLead.status = updateStatus;
      } else if (callOutcome === 'Interested' && targetLead.status !== 'Converted') {
        targetLead.status = 'Interested';
      } else if (callOutcome === 'Qualified' && targetLead.status !== 'Converted') {
        targetLead.status = 'Qualified';
      } else if (callOutcome === 'Not Interested' && targetLead.status !== 'Converted') {
        targetLead.status = 'Not Interested';
      } else if (targetLead.status === 'New') {
        targetLead.status = 'Contacted';
      }

      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'CALL_LOGGED',
        title: `${callType} Call — ${callStatus}${callOutcome ? ` (${callOutcome})` : ''}`,
        description: `${salesUser}: ${leadResponse ? `"${leadResponse}" ` : ''}${remarks ? `[${remarks}] ` : ''}${nextAction ? `Next Action: ${nextAction}` : ''}`,
        author: salesUser,
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      await targetLead.save();

      try {
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === targetLead._id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = targetLead.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {}

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'CALL_LOGGED',
        operator: req.user,
        updated_state: targetLead.toObject(),
        delta: `Logged ${callType} call (${callStatus}, ${callOutcome}) for ${targetLead.leadId}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'call_logged' });
      }

      return res.status(201).json({
        success: true,
        message: 'Communication call log recorded successfully',
        callLog: newCallLog,
        lead: targetLead,
      });
    }
  } catch (error) {
    console.error('Call log error:', error);
    res.status(500).json({ success: false, message: 'Failed to record call log', error: error.message });
  }
});

// @route   GET /api/leads/:id/calls
// @desc    Get all call logs for a lead in chronological order
// @access  Private
router.get('/:id/calls', protect, async (req, res) => {
  try {
    const { id } = req.params;
    let lead = null;

    if (fallbackStore.isFallback) {
      lead = (fallbackStore.leads || []).find((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
    } else {
      lead = await Lead.findById(id);
      if (!lead) lead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
    }

    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const callLogs = Array.isArray(lead.callLogs) ? lead.callLogs : [];
    return res.json({ success: true, count: callLogs.length, callLogs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch call history', error: error.message });
  }
});

// @route   POST /api/leads/:id/followups
// @desc    Schedule a follow-up for a lead
// @access  Private
router.post('/:id/followups', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      followUpDate,
      followUpTime = '',
      reason = '',
      assignedTo = req.user?.name || 'Sales User',
      remarks = '',
      status = 'Pending',
    } = req.body;

    if (!followUpDate) {
      return res.status(400).json({ success: false, message: 'Follow-Up Date is required' });
    }

    const io = req.app.get('io');
    let targetLead = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (idx === -1) return res.status(404).json({ success: false, message: 'Lead not found' });

      targetLead = fallbackStore.leads[idx];
      if (!canUserAccessLead(req.user, targetLead, fallbackStore.users || [])) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to schedule follow-up' });
      }

      const followUpId = 'FLW-' + Math.floor(1000 + Math.random() * 9000);
      const newFollowUp = {
        followUpId,
        followUpDate: new Date(followUpDate),
        followUpTime,
        reason: (reason || '').trim(),
        assignedTo: (assignedTo || targetLead.assignedTo || req.user?.name || '').trim(),
        remarks: (remarks || '').trim(),
        status: status || 'Pending',
        createdAt: new Date(),
      };

      if (!Array.isArray(targetLead.followups)) targetLead.followups = [];
      targetLead.followups.push(newFollowUp);

      targetLead.nextFollowUpDate = new Date(followUpDate);
      targetLead.nextFollowUpTime = followUpTime;
      targetLead.next_followup_at = new Date(followUpDate);

      if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'FOLLOWUP_SCHEDULED',
        title: `Follow-Up Scheduled: ${new Date(followUpDate).toLocaleDateString()}${followUpTime ? ` ${followUpTime}` : ''}`,
        description: `Reason: ${reason || 'Customer review'}. Assigned to ${assignedTo}.`,
        author: req.user?.name || 'System',
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      fallbackStore.saveToFile();

      await createFollowUpNotification({
        lead: targetLead,
        followUp: newFollowUp,
        assignerUser: req.user,
        io,
      });

      return res.status(201).json({
        success: true,
        message: 'Follow-up scheduled successfully',
        followup: newFollowUp,
        lead: targetLead,
      });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      if (!targetLead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, targetLead, allDbUsers)) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to schedule follow-up' });
      }

      const followUpId = 'FLW-' + Math.floor(1000 + Math.random() * 9000);
      const newFollowUp = {
        followUpId,
        followUpDate: new Date(followUpDate),
        followUpTime,
        reason: (reason || '').trim(),
        assignedTo: (assignedTo || targetLead.assignedTo || req.user?.name || '').trim(),
        remarks: (remarks || '').trim(),
        status: status || 'Pending',
        createdAt: new Date(),
      };

      targetLead.followups.push(newFollowUp);
      targetLead.nextFollowUpDate = new Date(followUpDate);
      targetLead.nextFollowUpTime = followUpTime;
      targetLead.next_followup_at = new Date(followUpDate);

      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'FOLLOWUP_SCHEDULED',
        title: `Follow-Up Scheduled: ${new Date(followUpDate).toLocaleDateString()}${followUpTime ? ` ${followUpTime}` : ''}`,
        description: `Reason: ${reason || 'Customer review'}. Assigned to ${assignedTo}.`,
        author: req.user?.name || 'System',
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      await targetLead.save();

      await createFollowUpNotification({
        lead: targetLead.toObject ? targetLead.toObject() : targetLead,
        followUp: newFollowUp,
        assignerUser: req.user,
        io,
      });

      return res.status(201).json({
        success: true,
        message: 'Follow-up scheduled successfully',
        followup: newFollowUp,
        lead: targetLead,
      });
    }
  } catch (error) {
    console.error('Schedule follow-up error:', error);
    res.status(500).json({ success: false, message: 'Failed to schedule follow-up', error: error.message });
  }
});

// @route   GET /api/leads/:id/followups
// @desc    Get all follow-ups for a lead
// @access  Private
router.get('/:id/followups', protect, async (req, res) => {
  try {
    const { id } = req.params;
    let lead = null;

    if (fallbackStore.isFallback) {
      lead = (fallbackStore.leads || []).find((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
    } else {
      lead = await Lead.findById(id);
      if (!lead) lead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
    }

    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const followups = Array.isArray(lead.followups) ? lead.followups : [];
    return res.json({ success: true, count: followups.length, followups });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch follow-ups', error: error.message });
  }
});

// @route   PUT /api/leads/:id/followups/:followUpId
// @desc    Update a follow-up status, remarks, or date
// @access  Private
router.put('/:id/followups/:followUpId', protect, async (req, res) => {
  try {
    const { id, followUpId } = req.params;
    const { status, remarks, followUpDate, followUpTime } = req.body;
    const io = req.app.get('io');

    let targetLead = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (idx === -1) return res.status(404).json({ success: false, message: 'Lead not found' });

      targetLead = fallbackStore.leads[idx];
      const flw = (targetLead.followups || []).find((f) => f.followUpId === followUpId || f._id?.toString() === followUpId);
      if (!flw) return res.status(404).json({ success: false, message: 'Follow-up not found' });

      if (status) flw.status = status;
      if (remarks !== undefined) flw.remarks = remarks;
      if (followUpDate) flw.followUpDate = new Date(followUpDate);
      if (followUpTime) flw.followUpTime = followUpTime;

      if (status === 'Completed') {
        flw.completedAt = new Date();
        flw.completedBy = req.user?.name || 'User';

        if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
        targetLead.timeline.push({
          eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
          eventType: 'FOLLOWUP_UPDATED',
          title: 'Follow-Up Completed',
          description: `Follow-up (${flw.reason || 'Callback'}) marked as Completed by ${req.user?.name || 'User'}.`,
          author: req.user?.name || 'User',
          timestamp: new Date(),
        });
      }

      targetLead.updatedAt = new Date();
      fallbackStore.saveToFile();

      if (io) io.emit('leads:updated', { lead: targetLead, action: 'followup_updated' });

      return res.json({ success: true, message: 'Follow-up updated successfully', followup: flw, lead: targetLead });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      if (!targetLead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const flw = targetLead.followups.find((f) => f.followUpId === followUpId || f._id?.toString() === followUpId);
      if (!flw) return res.status(404).json({ success: false, message: 'Follow-up not found' });

      if (status) flw.status = status;
      if (remarks !== undefined) flw.remarks = remarks;
      if (followUpDate) flw.followUpDate = new Date(followUpDate);
      if (followUpTime) flw.followUpTime = followUpTime;

      if (status === 'Completed') {
        flw.completedAt = new Date();
        flw.completedBy = req.user?.name || 'User';

        targetLead.timeline.push({
          eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
          eventType: 'FOLLOWUP_UPDATED',
          title: 'Follow-Up Completed',
          description: `Follow-up (${flw.reason || 'Callback'}) marked as Completed by ${req.user?.name || 'User'}.`,
          author: req.user?.name || 'User',
          timestamp: new Date(),
        });
      }

      targetLead.updatedAt = new Date();
      await targetLead.save();

      if (io) io.emit('leads:updated', { lead: targetLead, action: 'followup_updated' });

      return res.json({ success: true, message: 'Follow-up updated successfully', followup: flw, lead: targetLead });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update follow-up', error: error.message });
  }
});

// @route   POST /api/leads/:id/convert
// @desc    Convert a Lead to an Opportunity with strict status, duplicate prevention, and bidirectional linkage
// @access  Private
router.post('/:id/convert', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      opportunityName,
      dealValue = 0,
      amount = 0,
      stage = 'New Opportunity',
      expectedCloseDate,
      assignedTo,
      remarks = '',
      notes = '',
    } = req.body;

    const io = req.app.get('io');
    let targetLead = null;

    if (fallbackStore.isFallback) {
      const leadIndex = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (leadIndex === -1) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      targetLead = fallbackStore.leads[leadIndex];
      const priorState = { ...targetLead };

      if (!canUserAccessLead(req.user, targetLead, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to convert this lead',
        });
      }

      // 1. Strict Duplicate Conversion Prevention
      if (targetLead.status === 'Converted' || targetLead.opportunityId || targetLead.convertedOpportunityId) {
        const existingOppId = targetLead.opportunityId || 'already assigned';
        return res.status(400).json({
          success: false,
          message: `This Lead has already been converted to Opportunity ${existingOppId}. Duplicate conversion is strictly prohibited.`,
          opportunityId: targetLead.opportunityId,
        });
      }

      // 2. Strict Status Requirement: Only Qualified or Interested
      const currentStatus = targetLead.status || '';
      if (!['Qualified', 'Interested'].includes(currentStatus)) {
        return res.status(400).json({
          success: false,
          message: `A Lead can be converted into an Opportunity only when its status is Qualified or Interested. Current status is '${currentStatus}'.`,
        });
      }

      const oppAssignedTo = (assignedTo && assignedTo.trim()) || targetLead.assignedSalesUser || targetLead.assignedTo || req.user?.name || 'Current User';
      const hierarchyCheck = await validateHierarchyAssignment(req.user, oppAssignedTo);
      if (!hierarchyCheck.valid) {
        return res.status(400).json({
          success: false,
          message: hierarchyCheck.message,
        });
      }

      const oppTargetUserId = hierarchyCheck.targetUser?._id || targetLead.user || null;
      const assignerIdStr = req.user?._id ? (req.user._id.toString ? req.user._id.toString() : req.user._id) : undefined;
      const oppValue = Number(dealValue) || Number(amount) || targetLead.estimatedValue || targetLead.dealValue || targetLead.pipeline_value || 0;

      // Probability mapped from stage
      const stageProbMap = {
        'New Opportunity': 10,
        Contacted: 25,
        'Requirement Understanding': 40,
        'Proposal / Quotation': 60,
        'Proposal/Quotation': 60,
        Negotiation: 80,
        Won: 100,
        Lost: 0,
        Qualification: 20,
        'Needs Analysis': 40,
        Proposal: 60,
        'Closed Won': 100,
        'Closed Lost': 0,
      };
      const probability = stageProbMap[stage] !== undefined ? stageProbMap[stage] : 10;

      const generatedOppReadableId = await generateNextOpportunityId();
      const generatedOppId = '64e8e1' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);

      const oppRemarks = (remarks || notes || targetLead.remarks || targetLead.notes || '').trim();
      const oppTitle = (opportunityName && opportunityName.trim()) || `${targetLead.company || targetLead.name || 'Lead'} - Opportunity`;
      const leadContactPerson = targetLead.contactPerson || targetLead.name || '';
      const leadEmail = targetLead.email || '';
      const leadPhone = targetLead.phone || targetLead.mobileNumber || '';
      const leadSourceVal = targetLead.source || targetLead.campaign_source || 'Website';
      const leadIdVal = targetLead.leadId || targetLead.lead_id || targetLead._id.toString();

      const oppData = {
        _id: generatedOppId,
        opportunity_id: 'opp_' + crypto.randomUUID(),
        opportunityId: generatedOppReadableId,
        name: oppTitle,
        opportunityName: oppTitle,
        company: targetLead.company || '',
        contactPerson: leadContactPerson,
        email: leadEmail,
        phone: leadPhone,
        leadSource: leadSourceVal,
        campaign_source: targetLead.campaign_source || leadSourceVal,
        leadId: leadIdVal,
        originalLeadId: leadIdVal,
        relatedLead: targetLead._id,
        relatedLeadName: targetLead.name || leadContactPerson,
        sourceLeadName: targetLead.name || leadContactPerson,
        amount: oppValue,
        dealValue: oppValue,
        pipeline_value: oppValue,
        stage: stage || 'New Opportunity',
        opportunity_stage: (stage || 'New Opportunity').toUpperCase().replace(/[\s\/]+/g, '_'),
        probability,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        priority: targetLead.priority || 'Medium',
        cost_per_lead: targetLead.cost_per_lead || 25.0,
        assignedTo: oppAssignedTo,
        assignedBy: `${req.user?.name || 'User'} (${req.user?.role || 'User'})`,
        assignedById: assignerIdStr,
        user: oppTargetUserId,
        remarks: oppRemarks,
        notes: oppRemarks,
        lostReason: '',
        lostReasonDetails: '',
        wonAt: null,
        lostAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!fallbackStore.opportunities) fallbackStore.opportunities = [];
      fallbackStore.opportunities.unshift(oppData);

      // Update lead to Converted and record conversion linkage
      targetLead.status = 'Converted';
      targetLead.lead_status = 'CONVERTED';
      targetLead.opportunityId = generatedOppReadableId;
      targetLead.convertedOpportunityId = generatedOppId;
      targetLead.convertedAt = new Date();
      targetLead.convertedBy = req.user?._id || null;
      targetLead.convertedByName = req.user?.name || 'Sales User';

      // Add visual timeline event
      if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'CONVERTED_TO_OPPORTUNITY',
        title: `Converted to Opportunity ${generatedOppReadableId}`,
        description: `Lead converted to Opportunity "${oppData.name}" with deal value of ${oppValue > 0 ? '₹' + oppValue.toLocaleString() : '₹0'} in stage "${oppData.stage}".`,
        author: req.user?.name || 'System',
        authorId: req.user?._id?.toString() || '',
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'CONVERT',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead,
        delta: `Converted lead ${targetLead.leadId} to Opportunity ${generatedOppReadableId} (${oppData.name})`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'converted' });
        io.emit('opportunities:updated', { opportunity: oppData, action: 'created' });
      }

      return res.status(201).json({
        success: true,
        message: `Lead ${targetLead.leadId} successfully converted to Opportunity ${generatedOppReadableId}`,
        lead: targetLead,
        opportunity: oppData,
      });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) {
        targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      }
      if (!targetLead) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, targetLead, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to convert this lead',
        });
      }

      // 1. Strict Duplicate Conversion Prevention
      if (targetLead.status === 'Converted' || targetLead.opportunityId || targetLead.convertedOpportunityId) {
        const existingOppId = targetLead.opportunityId || 'already assigned';
        return res.status(400).json({
          success: false,
          message: `This Lead has already been converted to Opportunity ${existingOppId}. Duplicate conversion is strictly prohibited.`,
          opportunityId: targetLead.opportunityId,
        });
      }

      // 2. Strict Status Requirement: Only Qualified or Interested
      const currentStatus = targetLead.status || '';
      if (!['Qualified', 'Interested'].includes(currentStatus)) {
        return res.status(400).json({
          success: false,
          message: `A Lead can be converted into an Opportunity only when its status is Qualified or Interested. Current status is '${currentStatus}'.`,
        });
      }

      const priorState = targetLead.toObject();
      const oppAssignedTo = (assignedTo && assignedTo.trim()) || targetLead.assignedSalesUser || targetLead.assignedTo || req.user?.name || 'Current User';
      const hierarchyCheck = await validateHierarchyAssignment(req.user, oppAssignedTo);
      if (!hierarchyCheck.valid) {
        return res.status(400).json({
          success: false,
          message: hierarchyCheck.message,
        });
      }

      const oppTargetUserId = hierarchyCheck.targetUser?._id || targetLead.user || null;
      const assignerIdStr = req.user?._id ? (req.user._id.toString ? req.user._id.toString() : req.user._id) : undefined;
      const oppValue = Number(dealValue) || Number(amount) || targetLead.estimatedValue || targetLead.dealValue || targetLead.pipeline_value || 0;

      const stageProbMap = {
        'New Opportunity': 10,
        Contacted: 25,
        'Requirement Understanding': 40,
        'Proposal / Quotation': 60,
        'Proposal/Quotation': 60,
        Negotiation: 80,
        Won: 100,
        Lost: 0,
        Qualification: 20,
        'Needs Analysis': 40,
        Proposal: 60,
        'Closed Won': 100,
        'Closed Lost': 0,
      };
      const probability = stageProbMap[stage] !== undefined ? stageProbMap[stage] : 10;

      const generatedOppReadableId = await generateNextOpportunityId();
      const oppRemarks = (remarks || notes || targetLead.remarks || targetLead.notes || '').trim();
      const oppTitle = (opportunityName && opportunityName.trim()) || `${targetLead.company || targetLead.name || 'Lead'} - Opportunity`;
      const leadContactPerson = targetLead.contactPerson || targetLead.name || '';
      const leadEmail = targetLead.email || '';
      const leadPhone = targetLead.phone || targetLead.mobileNumber || '';
      const leadSourceVal = targetLead.source || targetLead.campaign_source || 'Website';
      const leadIdVal = targetLead.leadId || targetLead.lead_id || targetLead._id.toString();

      const oppData = {
        opportunity_id: 'opp_' + crypto.randomUUID(),
        opportunityId: generatedOppReadableId,
        name: oppTitle,
        opportunityName: oppTitle,
        company: targetLead.company || '',
        contactPerson: leadContactPerson,
        email: leadEmail,
        phone: leadPhone,
        leadSource: leadSourceVal,
        campaign_source: targetLead.campaign_source || leadSourceVal,
        leadId: leadIdVal,
        originalLeadId: leadIdVal,
        relatedLead: targetLead._id,
        relatedLeadName: targetLead.name || leadContactPerson,
        sourceLeadName: targetLead.name || leadContactPerson,
        amount: oppValue,
        dealValue: oppValue,
        pipeline_value: oppValue,
        stage: stage || 'New Opportunity',
        opportunity_stage: (stage || 'New Opportunity').toUpperCase().replace(/[\s\/]+/g, '_'),
        probability,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        priority: targetLead.priority || 'Medium',
        cost_per_lead: targetLead.cost_per_lead || 25.0,
        assignedTo: oppAssignedTo,
        assignedBy: `${req.user?.name || 'User'} (${req.user?.role || 'User'})`,
        assignedById: assignerIdStr,
        user: oppTargetUserId,
        remarks: oppRemarks,
        notes: oppRemarks,
        lostReason: '',
        lostReasonDetails: '',
        wonAt: null,
        lostAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const opportunity = await Opportunity.create(oppData);

      targetLead.status = 'Converted';
      targetLead.lead_status = 'CONVERTED';
      targetLead.opportunityId = generatedOppReadableId;
      targetLead.convertedOpportunityId = opportunity._id;
      targetLead.convertedAt = new Date();
      targetLead.convertedBy = req.user?._id || null;
      targetLead.convertedByName = req.user?.name || 'Sales User';

      targetLead.timeline.push({
        eventId: 'EVT-' + Math.floor(1000 + Math.random() * 9000),
        eventType: 'CONVERTED_TO_OPPORTUNITY',
        title: `Converted to Opportunity ${generatedOppReadableId}`,
        description: `Lead converted to Opportunity "${opportunity.name}" with deal value of ${oppValue > 0 ? '₹' + oppValue.toLocaleString() : '₹0'} in stage "${oppData.stage}".`,
        author: req.user?.name || 'System',
        authorId: req.user?._id?.toString() || '',
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      await targetLead.save();

      // Mirror to fallbackStore
      try {
        if (!fallbackStore.opportunities) fallbackStore.opportunities = [];
        fallbackStore.opportunities.unshift(opportunity.toObject());
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === targetLead._id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = targetLead.toObject();
        }
        fallbackStore.saveToFile();
      } catch (err) {}

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'CONVERT',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead.toObject(),
        delta: `Converted lead ${targetLead.leadId} to Opportunity ${generatedOppReadableId} (${opportunity.name})`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'converted' });
        io.emit('opportunities:updated', { opportunity, action: 'created' });
      }

      return res.status(201).json({
        success: true,
        message: `Lead ${targetLead.leadId} successfully converted to Opportunity ${generatedOppReadableId}`,
        lead: targetLead,
        opportunity,
      });
    }
  } catch (error) {
    console.error('Convert lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert lead to opportunity',
      error: error.message,
    });
  }
});

// @route   DELETE /api/leads/:id
// @desc    Delete a lead with authorization check & immutable audit log
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const leadIndex = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (leadIndex === -1) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }

      const existing = fallbackStore.leads[leadIndex];
      if (!canUserAccessLead(req.user, existing, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to delete this lead',
        });
      }

      const deleted = fallbackStore.leads.splice(leadIndex, 1)[0];
      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: deleted._id,
        action: 'DELETE',
        operator: req.user,
        prior_state: deleted,
        delta: `Deleted lead ${deleted.leadId || ''} "${deleted.name}"`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { id, action: 'deleted' });
      }

      return res.json({
        success: true,
        message: 'Lead deleted successfully',
        lead: deleted,
      });
    } else {
      let lead = await Lead.findById(id);
      if (!lead) lead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, lead, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to delete this lead',
        });
      }

      const priorState = lead.toObject();
      await Lead.findByIdAndDelete(lead._id);

      try {
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads.splice(localIdx, 1);
          fallbackStore.saveToFile();
        }
      } catch (err) {}

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: lead._id,
        action: 'DELETE',
        operator: req.user,
        prior_state: priorState,
        delta: `Deleted lead ${priorState.leadId || ''} "${priorState.name}"`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { id: lead._id, action: 'deleted' });
      }

      return res.json({
        success: true,
        message: 'Lead deleted successfully',
        lead,
      });
    }
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete lead',
      error: error.message,
    });
  }
});

// @route   POST /api/leads/filter
// @desc    Advanced Multi-Dimensional Filtrations Engine (Temporal, Categorical, Numeric, Full-Text)
// @access  Private
router.post('/filter', protect, async (req, res) => {
  const startTime = Date.now();
  try {
    const { rules = [], logic = 'AND' } = req.body;
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';

    let allLeads = [];
    if (fallbackStore.isFallback) {
      allLeads = [...(fallbackStore.leads || [])];
      if (!isSuperAdmin) {
        allLeads = allLeads.filter((l) => canUserAccessLead(req.user, l, fallbackStore.users || []));
      }
    } else {
      if (isSuperAdmin) {
        allLeads = await Lead.find({}).lean();
      } else {
        const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
        const fullLeads = await Lead.find({}).lean();
        allLeads = fullLeads.filter((l) => canUserAccessLead(req.user, l, allDbUsers));
      }
    }

    if (!Array.isArray(rules) || rules.length === 0) {
      return res.json({
        success: true,
        count: allLeads.length,
        executionTimeMs: Date.now() - startTime,
        leads: allLeads,
      });
    }

    const evaluateRule = (lead, rule) => {
      const { field, operator, value, valueTo } = rule;
      if (!field || !operator) return true;

      let recordVal = lead[field];
      if (field === 'pipeline_value' && (recordVal === undefined || recordVal === 0)) {
        recordVal = lead.dealValue || lead.estimatedValue || 0;
      }
      if (field === 'lead_status' && !recordVal) {
        recordVal = lead.status;
      }

      switch (operator) {
        case 'BETWEEN': {
          if (!recordVal || !value || !valueTo) return false;
          const target = new Date(recordVal).getTime();
          return target >= new Date(value).getTime() && target <= new Date(valueTo).getTime();
        }
        case 'GREATER_THAN': {
          if (!recordVal || !value) return false;
          return new Date(recordVal).getTime() > new Date(value).getTime();
        }
        case 'LESS_THAN': {
          if (!recordVal || !value) return false;
          return new Date(recordVal).getTime() < new Date(value).getTime();
        }
        case 'EQUALS': {
          if (recordVal === undefined || recordVal === null) return false;
          return String(recordVal).toLowerCase() === String(value).toLowerCase();
        }
        case 'IN': {
          if (!Array.isArray(value)) {
            const arr = String(value).split(',').map((s) => s.trim().toLowerCase());
            return arr.includes(String(recordVal || '').toLowerCase());
          }
          return value.map((v) => String(v).toLowerCase()).includes(String(recordVal || '').toLowerCase());
        }
        case 'NOT IN': {
          if (!Array.isArray(value)) {
            const arr = String(value).split(',').map((s) => s.trim().toLowerCase());
            return !arr.includes(String(recordVal || '').toLowerCase());
          }
          return !value.map((v) => String(v).toLowerCase()).includes(String(recordVal || '').toLowerCase());
        }
        case 'GT': {
          return Number(recordVal || 0) > Number(value || 0);
        }
        case 'LT': {
          return Number(recordVal || 0) < Number(value || 0);
        }
        case 'RANGE': {
          const num = Number(recordVal || 0);
          return num >= Number(value || 0) && num <= Number(valueTo || 0);
        }
        case 'FUZZY':
        case 'WILDCARD':
        case 'PHRASE MATCH': {
          const query = String(value || '').toLowerCase();
          const targetText = [
            lead.name,
            lead.contactPerson,
            lead.company,
            lead.email,
            lead.phone,
            lead.mobileNumber,
            lead.notes,
            lead.remarks,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return targetText.includes(query);
        }
        default:
          return true;
      }
    };

    const filteredLeads = allLeads.filter((lead) => {
      if (logic === 'OR') {
        return rules.some((rule) => evaluateRule(lead, rule));
      }
      return rules.every((rule) => evaluateRule(lead, rule));
    });

    res.json({
      success: true,
      count: filteredLeads.length,
      executionTimeMs: Date.now() - startTime,
      appliedRulesCount: rules.length,
      logic,
      leads: filteredLeads,
    });
  } catch (error) {
    console.error('Filter engine error:', error);
    res.status(500).json({
      success: false,
      message: 'Advanced filtration engine error',
      error: error.message,
    });
  }
});

// @route   POST /api/leads/:id/disposition
// @desc    Log disposition with Disposition Framework Matrix automated triggers
// @access  Private
router.post('/:id/disposition', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      disposition_code,
      notes = '',
      duration_seconds = 0,
      next_followup_at = null,
      custom_deal_value = null,
    } = req.body;

    if (!disposition_code || !VALID_DISPOSITIONS.includes(disposition_code)) {
      return res.status(400).json({
        success: false,
        message: `Invalid disposition_code. Must be one of: ${VALID_DISPOSITIONS.join(', ')}`,
      });
    }

    const io = req.app.get('io');
    const agentName = req.user?.name || 'Sales Representative';
    const agentId = req.user?._id?.toString() || req.user?.id?.toString() || '';

    let targetLead = null;
    let priorState = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (idx === -1) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      targetLead = fallbackStore.leads[idx];
      priorState = { ...targetLead };

      if (!canUserAccessLead(req.user, targetLead, fallbackStore.users || [])) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to update disposition' });
      }

      targetLead.disposition_code = disposition_code;
      targetLead.last_disposition_at = new Date();
      targetLead.last_contacted_at = new Date();
      targetLead.lastContactDate = new Date();
      targetLead.sla_tier = 0;

      if (!targetLead.disposition_history) targetLead.disposition_history = [];

      let systemActionExecuted = '';

      switch (disposition_code) {
        case 'NO_ANSWER': {
          targetLead.status = 'In Progress';
          targetLead.lead_status = 'IN_PROGRESS';
          targetLead.retry_count = (targetLead.retry_count || 0) + 1;
          const followupDate = new Date(Date.now() + 120 * 60 * 1000);
          targetLead.next_followup_at = followupDate;
          targetLead.nextFollowUpDate = followupDate;
          systemActionExecuted = `Increment retry count (${targetLead.retry_count}/5). Auto-rescheduled follow-up in +120 minutes.`;
          break;
        }

        case 'BUSY': {
          targetLead.status = 'In Progress';
          targetLead.lead_status = 'IN_PROGRESS';
          targetLead.retry_count = (targetLead.retry_count || 0) + 1;
          const followupDate = new Date(Date.now() + 30 * 60 * 1000);
          targetLead.next_followup_at = followupDate;
          targetLead.nextFollowUpDate = followupDate;
          systemActionExecuted = `Queued for auto-dialer retry pool in 30 minutes.`;
          break;
        }

        case 'CALL_BACK': {
          targetLead.status = 'Follow-Up';
          targetLead.lead_status = 'IN_PROGRESS';
          const scheduledTime = next_followup_at ? new Date(next_followup_at) : new Date(Date.now() + 24 * 60 * 60 * 1000);
          targetLead.next_followup_at = scheduledTime;
          targetLead.nextFollowUpDate = scheduledTime;
          systemActionExecuted = `Injected to calendar schedule at ${scheduledTime.toISOString()}.`;
          break;
        }

        case 'NOT_INTERESTED': {
          targetLead.status = 'Not Interested';
          targetLead.lead_status = 'LOST';
          targetLead.suppression_status = true;
          targetLead.next_followup_at = null;
          targetLead.nextFollowUpDate = null;
          systemActionExecuted = `Triggered suppression list update. Terminated outbound queuing rules.`;
          break;
        }

        case 'QUALIFIED_OPPORTUNITY': {
          targetLead.status = 'Qualified';
          systemActionExecuted = `Marked lead as Qualified for opportunity conversion.`;
          break;
        }

        default:
          break;
      }

      targetLead.disposition_history.unshift({
        disposition_code,
        notes: notes.trim(),
        agent_name: agentName,
        agent_id: agentId,
        duration_seconds: Number(duration_seconds) || 0,
        next_followup_at: targetLead.next_followup_at,
        retry_count: targetLead.retry_count || 0,
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Disposition',
        entity_id: targetLead._id || targetLead.lead_id,
        action: 'DISPOSITION_LOGGED',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead,
        delta: `Logged disposition "${disposition_code}" by ${agentName}. Action: ${systemActionExecuted}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'disposition_logged' });
        io.emit('disposition:logged', { leadId: targetLead._id, disposition_code, agentName });
      }

      return res.json({
        success: true,
        message: `Disposition "${disposition_code}" logged successfully.`,
        systemActionExecuted,
        lead: targetLead,
      });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) {
        targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      }
      if (!targetLead) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      priorState = targetLead.toObject();

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, targetLead, allDbUsers)) {
        return res.status(403).json({ success: false, message: 'Forbidden: No permission to update disposition' });
      }

      targetLead.disposition_code = disposition_code;
      targetLead.last_disposition_at = new Date();
      targetLead.last_contacted_at = new Date();
      targetLead.lastContactDate = new Date();
      targetLead.sla_tier = 0;

      let systemActionExecuted = '';

      switch (disposition_code) {
        case 'NO_ANSWER': {
          targetLead.status = 'In Progress';
          targetLead.lead_status = 'IN_PROGRESS';
          targetLead.retry_count = (targetLead.retry_count || 0) + 1;
          const followupDate = new Date(Date.now() + 120 * 60 * 1000);
          targetLead.next_followup_at = followupDate;
          targetLead.nextFollowUpDate = followupDate;
          systemActionExecuted = `Increment retry count (${targetLead.retry_count}/5). Auto-rescheduled callback in +120 minutes.`;
          break;
        }

        case 'BUSY': {
          targetLead.status = 'In Progress';
          targetLead.lead_status = 'IN_PROGRESS';
          targetLead.retry_count = (targetLead.retry_count || 0) + 1;
          const followupDate = new Date(Date.now() + 30 * 60 * 1000);
          targetLead.next_followup_at = followupDate;
          targetLead.nextFollowUpDate = followupDate;
          systemActionExecuted = `Queued for auto-dialer retry pool in 30 minutes.`;
          break;
        }

        case 'CALL_BACK': {
          targetLead.status = 'Follow-Up';
          targetLead.lead_status = 'IN_PROGRESS';
          const scheduledTime = next_followup_at ? new Date(next_followup_at) : new Date(Date.now() + 24 * 60 * 60 * 1000);
          targetLead.next_followup_at = scheduledTime;
          targetLead.nextFollowUpDate = scheduledTime;
          systemActionExecuted = `Injected to calendar schedule at ${scheduledTime.toISOString()}.`;
          break;
        }

        case 'NOT_INTERESTED': {
          targetLead.status = 'Not Interested';
          targetLead.lead_status = 'LOST';
          targetLead.suppression_status = true;
          targetLead.next_followup_at = null;
          targetLead.nextFollowUpDate = null;
          systemActionExecuted = `Triggered suppression list update. Terminated outbound queuing rules.`;
          break;
        }

        case 'QUALIFIED_OPPORTUNITY': {
          targetLead.status = 'Qualified';
          systemActionExecuted = `Marked lead as Qualified for opportunity conversion.`;
          break;
        }

        default:
          break;
      }

      targetLead.disposition_history.unshift({
        disposition_code,
        notes: notes.trim(),
        agent_name: agentName,
        agent_id: agentId,
        duration_seconds: Number(duration_seconds) || 0,
        next_followup_at: targetLead.next_followup_at,
        retry_count: targetLead.retry_count || 0,
        timestamp: new Date(),
      });

      targetLead.updatedAt = new Date();
      await targetLead.save();

      try {
        const localIdx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === targetLead._id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = targetLead.toObject();
          fallbackStore.saveToFile();
        }
      } catch (e) {}

      await logAuditAction({
        entity_type: 'Disposition',
        entity_id: targetLead._id,
        action: 'DISPOSITION_LOGGED',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead.toObject(),
        delta: `Logged disposition "${disposition_code}" by ${agentName}. Action: ${systemActionExecuted}`,
        req,
      });

      if (io) {
        io.emit('leads:updated', { lead: targetLead.toObject(), action: 'disposition_logged' });
        io.emit('disposition:logged', { leadId: targetLead._id, disposition_code, agentName });
      }

      return res.json({
        success: true,
        message: `Disposition "${disposition_code}" logged successfully.`,
        systemActionExecuted,
        lead: targetLead,
      });
    }
  } catch (error) {
    console.error('Disposition logging error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log disposition',
      error: error.message,
    });
  }
});

// @route   POST /api/leads/:id/claim
// @desc    Claim an unassigned high-priority lead from shared queue
// @access  Private
router.post('/:id/claim', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');
    const claimerName = req.user?.name || 'Sales Representative';
    const claimerId = req.user?._id || req.user?.id;

    let targetLead = null;
    let priorState = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString() || l.lead_id === id || l.leadId === id);
      if (idx === -1) return res.status(404).json({ success: false, message: 'Lead not found' });

      targetLead = fallbackStore.leads[idx];
      priorState = { ...targetLead };

      targetLead.assignedTo = claimerName;
      targetLead.assignedSalesUser = claimerName;
      targetLead.user = claimerId;
      targetLead.is_high_priority_pool = false;
      targetLead.sla_unassigned = false;
      targetLead.sla_tier = 0;
      targetLead.status = 'In Progress';
      targetLead.lead_status = 'IN_PROGRESS';
      targetLead.updatedAt = new Date();

      fallbackStore.saveToFile();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'LEAD_CLAIMED',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead,
        delta: `Lead claimed by ${claimerName} from High-Priority Shared Queue`,
        req,
      });

      await createLeadAssignmentNotification({
        lead: targetLead,
        targetAssignedTo: claimerName,
        targetUserId: claimerId,
        assignerUser: req.user,
        io,
      });

      return res.json({
        success: true,
        message: `Lead successfully claimed by ${claimerName}`,
        lead: targetLead,
      });
    } else {
      targetLead = await Lead.findById(id);
      if (!targetLead) targetLead = await Lead.findOne({ $or: [{ lead_id: id }, { leadId: id }] });
      if (!targetLead) return res.status(404).json({ success: false, message: 'Lead not found' });

      priorState = targetLead.toObject();
      targetLead.assignedTo = claimerName;
      targetLead.assignedSalesUser = claimerName;
      targetLead.user = claimerId;
      targetLead.is_high_priority_pool = false;
      targetLead.sla_unassigned = false;
      targetLead.sla_tier = 0;
      targetLead.status = 'In Progress';
      targetLead.lead_status = 'IN_PROGRESS';
      targetLead.updatedAt = new Date();
      await targetLead.save();

      await logAuditAction({
        entity_type: 'Lead',
        entity_id: targetLead._id,
        action: 'LEAD_CLAIMED',
        operator: req.user,
        prior_state: priorState,
        updated_state: targetLead.toObject(),
        delta: `Lead claimed by ${claimerName} from High-Priority Shared Queue`,
        req,
      });

      await createLeadAssignmentNotification({
        lead: targetLead.toObject ? targetLead.toObject() : targetLead,
        targetAssignedTo: claimerName,
        targetUserId: claimerId,
        assignerUser: req.user,
        io,
      });

      return res.json({
        success: true,
        message: `Lead successfully claimed by ${claimerName}`,
        lead: targetLead,
      });
    }
  } catch (err) {
    console.error('Claim lead error:', err);
    res.status(500).json({ success: false, message: 'Failed to claim lead', error: err.message });
  }
});

module.exports = router;
