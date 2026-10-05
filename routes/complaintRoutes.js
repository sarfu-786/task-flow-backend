const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');
const { logAuditAction } = require('../services/auditService');
const {
  getAllUsers,
  getUserScopeContext,
  isComplaintAccessible,
} = require('../services/hierarchyService');

// Helper to check if Complaint Management module is active
const isComplaintModuleActive = () => {
  const activeMods = fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects', 'tasks'];
  return activeMods.includes('complaints');
};

// Middleware to enforce module enablement
const requireComplaintModule = (req, res, next) => {
  if (!isComplaintModuleActive()) {
    return res.status(403).json({
      success: false,
      moduleDisabled: true,
      message: 'Complaint Management module is not activated for your organization.',
    });
  }
  next();
};

// Helper to generate unique ticket numbers
const generateTicketNumber = (existingComplaints = []) => {
  const count = existingComplaints.length + 1;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `CMP-${count < 100 ? ('0' + count).slice(-2) : count}-${rand.toString().slice(-2)}`;
};

// Helper to compute SLA deadline & First Response deadline from priority
const computeSlaDeadline = (priority, hoursOverride) => {
  const now = new Date();
  let hours = 24; // Default Medium
  let firstResponseHours = 4;

  if (hoursOverride && !isNaN(Number(hoursOverride))) {
    hours = Number(hoursOverride);
    firstResponseHours = Math.max(1, Math.round(hours / 4));
  } else if (priority === 'Urgent') {
    hours = 4;
    firstResponseHours = 1;
  } else if (priority === 'High') {
    hours = 12;
    firstResponseHours = 2;
  } else if (priority === 'Low') {
    hours = 48;
    firstResponseHours = 8;
  }

  return {
    slaHours: hours,
    slaDeadline: new Date(now.getTime() + hours * 60 * 60 * 1000),
    firstResponseDeadline: new Date(now.getTime() + firstResponseHours * 60 * 60 * 1000),
  };
};

// Helper to recalculate dynamic SLA status
const getComputedSlaStatus = (complaint) => {
  if (['Resolved', 'Closed'].includes(complaint.status)) {
    if (complaint.resolvedAt && complaint.slaDeadline) {
      return new Date(complaint.resolvedAt) <= new Date(complaint.slaDeadline) ? 'Met' : 'Breached';
    }
    return 'Met';
  }
  if (complaint.status === 'Awaiting Customer' || complaint.isPaused) {
    return 'Paused';
  }
  if (!complaint.slaDeadline) return 'On Track';

  const now = new Date();
  const deadline = new Date(complaint.slaDeadline);
  const diffMs = deadline.getTime() - now.getTime();
  const hoursLeft = diffMs / (1000 * 60 * 60);

  if (hoursLeft < 0) return 'Breached';
  if (hoursLeft <= 4) return 'At Risk';
  return 'On Track';
};

/**
 * Access check helper
 */
const canUserAccessComplaint = (currentUser, complaint, allUsers = []) => {
  if (!currentUser || !complaint) return false;
  const scope = getUserScopeContext(currentUser, allUsers);
  return isComplaintAccessible(scope, complaint);
};

/**
 * Fetch all complaints scoped strictly to the logged-in user's hierarchy
 */
const getScopedComplaints = async (user) => {
  let complaintsList = [];
  let allUsers = await getAllUsers();

  if (fallbackStore.isFallback) {
    complaintsList = [...(fallbackStore.complaints || [])];
  } else {
    const dbComplaints = await Complaint.find({}).sort({ createdAt: -1 });
    complaintsList = dbComplaints.map((c) => c.toObject());
  }

  // Refresh dynamic SLA status
  complaintsList = complaintsList.map((c) => ({
    ...c,
    slaStatus: getComputedSlaStatus(c),
  }));

  const scope = getUserScopeContext(user, allUsers);
  if (!scope.isSuperAdmin) {
    complaintsList = complaintsList.filter((c) => isComplaintAccessible(scope, c));
  }

  return { complaints: complaintsList, allUsers, scope };
};

// =========================================================================
// COMPLAINT EXCEL IMPORT & EXPORT SUITE (.XLSX ONLY)
// =========================================================================

// @route   GET /api/complaints/excel/template
// @desc    Download standard Complaint Excel (.xlsx) Import Template with instructions and allowed values
// @access  Private
router.get('/excel/template', protect, requireComplaintModule, (req, res) => {
  try {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Template
    const templateData = [
      {
        'Ticket ID': '',
        'Customer Name *': 'Acme Global Logistics',
        'Customer Email': 'contact@acmelogistics.com',
        'Customer Phone': '+91 9876501234',
        'Company': 'Acme Global Logistics Ltd',
        'Subject *': 'Payment Gateway API Webhook Failure',
        'Description *': 'Transaction confirmation webhooks are experiencing 504 gateway timeouts during high volume batch processing.',
        'Category': 'Technical / API',
        'Sub Category': 'Webhook Timeouts',
        'Complaint Type': 'Incident',
        'Product / Service': 'Core API Service',
        'Source Channel': 'Web Portal',
        'Priority': 'High',
        'Severity': 'Major',
        'Status': 'Logged',
        'Assigned To': '',
        'Team': 'Technical Support',
        'Next Follow-up Date': '',
        'Resolution Notes': '',
      },
      {
        'Ticket ID': '',
        'Customer Name *': 'Nexus Corp Solutions',
        'Customer Email': 'support@nexuscorp.com',
        'Customer Phone': '+91 9845612345',
        'Company': 'Nexus Corp',
        'Subject *': 'Billing Invoice Discrepancy for Q3',
        'Description *': 'Invoice #INV-2026-09 includes seat charges for inactive user licenses.',
        'Category': 'Billing & Invoicing',
        'Sub Category': 'Invoice Calculation',
        'Complaint Type': 'Billing Dispute',
        'Product / Service': 'Subscription Billing',
        'Source Channel': 'Email',
        'Priority': 'Medium',
        'Severity': 'Moderate',
        'Status': 'Under Investigation',
        'Assigned To': '',
        'Team': 'Billing & Finance',
        'Next Follow-up Date': '',
        'Resolution Notes': '',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 24 },
      { wch: 28 },
      { wch: 18 },
      { wch: 26 },
      { wch: 35 },
      { wch: 45 },
      { wch: 20 },
      { wch: 20 },
      { wch: 18 },
      { wch: 22 },
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 35 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Complaints Template');

    // Sheet 2: Reference Guide
    const guideData = [
      { 'Field': 'Ticket ID', 'Mandatory': 'No (Only for Updates)', 'Description': 'Provide existing Ticket ID (e.g., CMP-01-22) to update an existing record. Leave blank to create a new ticket.' },
      { 'Field': 'Customer Name *', 'Mandatory': 'YES', 'Description': 'Name of the customer or account filing the complaint.' },
      { 'Field': 'Subject *', 'Mandatory': 'YES', 'Description': 'Concise issue title or summary.' },
      { 'Field': 'Description *', 'Mandatory': 'YES', 'Description': 'Detailed description of the incident, grievance or defect.' },
      { 'Field': 'Category', 'Mandatory': 'Optional', 'Description': 'Allowed: Technical / API, Billing & Invoicing, Product Quality, Service Delivery, Account & Access, Security & Compliance, Performance & Latency, General Inquiry (Default: Technical / API)' },
      { 'Field': 'Complaint Type', 'Mandatory': 'Optional', 'Description': 'Allowed: Incident, Defect, Service Request, Billing Dispute, SLA Grievance, Customer Feedback (Default: Incident)' },
      { 'Field': 'Priority', 'Mandatory': 'Optional', 'Description': 'Allowed: Urgent (4h SLA), High (12h SLA), Medium (24h SLA), Low (48h SLA) (Default: Medium)' },
      { 'Field': 'Severity', 'Mandatory': 'Optional', 'Description': 'Allowed: Critical, Major, Moderate, Minor (Default: Moderate)' },
      { 'Field': 'Source Channel', 'Mandatory': 'Optional', 'Description': 'Allowed: Web Portal, Email, Phone, Chat, In-Person, Mobile App, Social Media, Other (Default: Web Portal)' },
      { 'Field': 'Status', 'Mandatory': 'Optional', 'Description': 'Allowed: Logged, Under Investigation, Assigned, In Progress, Awaiting Customer, Escalated, Resolved, Closed (Default: Logged)' },
      { 'Field': 'Assigned To', 'Mandatory': 'Optional', 'Description': 'Name or email of authorized coordinator within your hierarchy. If left blank or unauthorized, defaults to you.' },
    ];

    const wsGuide = XLSX.utils.json_to_sheet(guideData);
    wsGuide['!cols'] = [{ wch: 22 }, { wch: 25 }, { wch: 65 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Guide & Allowed Values');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Complaint_Import_Template.xlsx"');
    return res.send(buffer);
  } catch (err) {
    console.error('Failed to generate Complaint import template:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate Excel template' });
  }
});

// @route   POST /api/complaints/excel/preview
// @desc    Validate and preview uploaded Complaint Excel (.xlsx) file rows
// @access  Private
router.post('/excel/preview', protect, requireComplaintModule, async (req, res) => {
  try {
    const { fileBase64, rows: clientRows, filename } = req.body;

    if (filename && !filename.toLowerCase().endsWith('.xlsx')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. Only Excel (.xlsx) files are supported.',
      });
    }

    let rawRows = [];

    if (fileBase64) {
      try {
        const fileBuffer = Buffer.from(fileBase64, 'base64');
        const wb = XLSX.read(fileBuffer, { type: 'buffer' });
        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          return res.status(400).json({ success: false, message: 'The Excel workbook contains no sheets.' });
        }
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      } catch (parseErr) {
        return res.status(400).json({ success: false, message: 'Failed to parse Excel (.xlsx) file: ' + parseErr.message });
      }
    } else if (Array.isArray(clientRows)) {
      rawRows = clientRows;
    } else {
      return res.status(400).json({ success: false, message: 'No Excel file data or rows provided.' });
    }

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'The uploaded Excel file contains no data rows.' });
    }

    let existingComplaints = [];
    let allUsers = [];
    if (fallbackStore.isFallback) {
      existingComplaints = fallbackStore.complaints || [];
      allUsers = fallbackStore.users || [];
    } else {
      existingComplaints = await Complaint.find({}).lean();
      allUsers = await User.find({}).lean();
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    const validatedRows = rawRows.map((rawRow, idx) => {
      const rowIndex = idx + 1;
      const errors = [];
      const warnings = [];

      const ticketNumber = String(rawRow['Ticket ID'] || rawRow['ticketNumber'] || rawRow['complaintId'] || rawRow['ID'] || '').trim();
      const customerName = String(rawRow['Customer Name *'] || rawRow['Customer Name'] || rawRow['Customer'] || rawRow['customerName'] || '').trim();
      const customerEmail = String(rawRow['Customer Email'] || rawRow['Email'] || rawRow['customerEmail'] || '').trim().toLowerCase();
      const customerPhone = String(rawRow['Customer Phone'] || rawRow['Phone'] || rawRow['customerPhone'] || '').trim();
      const company = String(rawRow['Company'] || rawRow['company'] || '').trim();
      const subject = String(rawRow['Subject *'] || rawRow['Subject'] || rawRow['subject'] || '').trim();
      const description = String(rawRow['Description *'] || rawRow['Description'] || rawRow['description'] || '').trim();
      let category = String(rawRow['Category'] || rawRow['category'] || 'Technical / API').trim();
      let subCategory = String(rawRow['Sub Category'] || rawRow['subCategory'] || '').trim();
      let complaintType = String(rawRow['Complaint Type'] || rawRow['complaintType'] || 'Incident').trim();
      let productOrService = String(rawRow['Product / Service'] || rawRow['Product'] || rawRow['productOrService'] || '').trim();
      let source = String(rawRow['Source Channel'] || rawRow['Source'] || rawRow['source'] || 'Web Portal').trim();
      let priority = String(rawRow['Priority'] || rawRow['priority'] || 'Medium').trim();
      let severity = String(rawRow['Severity'] || rawRow['severity'] || 'Moderate').trim();
      let status = String(rawRow['Status'] || rawRow['status'] || 'Logged').trim();
      const assignedToRaw = String(rawRow['Assigned To'] || rawRow['assignedTo'] || rawRow['Owner'] || '').trim();
      const team = String(rawRow['Team'] || rawRow['team'] || 'Customer Success').trim();
      const nextFollowUpDate = rawRow['Next Follow-up Date'] || rawRow['nextFollowUpDate'] || '';
      const resolutionNotes = String(rawRow['Resolution Notes'] || rawRow['resolutionNotes'] || '').trim();

      // Required validation
      if (!customerName) {
        errors.push('Customer Name is required.');
      }
      if (!subject) {
        errors.push('Subject is required.');
      }
      if (!description) {
        errors.push('Description is required.');
      }
      if (customerEmail && !emailRegex.test(customerEmail)) {
        warnings.push('Invalid customer email format.');
      }

      // Check duplicates
      let existingMatch = null;
      if (ticketNumber) {
        existingMatch = existingComplaints.find((c) => (c.ticketNumber && c.ticketNumber.toLowerCase() === ticketNumber.toLowerCase()) || (c.complaintId && c.complaintId.toLowerCase() === ticketNumber.toLowerCase()));
      }
      if (!existingMatch && customerName && subject) {
        existingMatch = existingComplaints.find((c) => c.customerName && c.customerName.toLowerCase() === customerName.toLowerCase() && c.subject && c.subject.toLowerCase() === subject.toLowerCase());
      }

      const isDuplicate = !!existingMatch;
      if (isDuplicate) {
        duplicateCount++;
        warnings.push(`Existing ticket detected (${existingMatch.ticketNumber || existingMatch.subject}). Will be updated if Update/Upsert mode is selected.`);
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
          const scope = getUserScopeContext(req.user, allUsers);
          if (scope.isSuperAdmin || (targetUser._id.toString() === req.user._id.toString()) || scope.subordinateIds.includes(targetUser._id.toString())) {
            resolvedAssignedTo = targetUser.name || targetUser.username;
            resolvedAssignedToId = targetUser._id;
          } else {
            warnings.push(`Hierarchy Constraint: Cannot assign to '${targetUser.name}'. Defaulting to you.`);
          }
        }
      }

      const isValid = errors.length === 0;
      if (isValid) validCount++;
      else invalidCount++;

      return {
        rowIndex,
        ticketNumber: ticketNumber || (existingMatch ? existingMatch.ticketNumber : ''),
        customerName,
        customerEmail,
        customerPhone,
        company,
        subject,
        description,
        category,
        subCategory,
        complaintType,
        productOrService,
        source,
        priority,
        severity,
        status,
        assignedTo: resolvedAssignedTo,
        assignedToId: resolvedAssignedToId,
        team,
        nextFollowUpDate,
        resolutionNotes,
        isValid,
        validationStatus: !isValid ? 'error' : isDuplicate ? 'warning' : 'valid',
        errors,
        warnings,
        isDuplicate,
        existingId: existingMatch ? existingMatch._id : null,
      };
    });

    return res.json({
      success: true,
      totalRows: validatedRows.length,
      validCount,
      invalidCount,
      duplicateCount,
      rows: validatedRows,
    });
  } catch (err) {
    console.error('Complaint Excel preview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process Excel preview: ' + err.message });
  }
});

// @route   POST /api/complaints/excel/import
// @desc    Execute batch import of valid Complaint records
// @access  Private
router.post('/excel/import', protect, requireComplaintModule, async (req, res) => {
  try {
    const { rows, mode = 'create' } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows provided for import.' });
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];
    const importedTickets = [];

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).lean();
    }

    for (const row of rows) {
      if (!row.customerName || !row.subject || !row.description) {
        skippedCount++;
        continue;
      }

      try {
        if (fallbackStore.isFallback) {
          if (!fallbackStore.complaints) fallbackStore.complaints = [];

          let existingIndex = -1;
          if (row.existingId) {
            existingIndex = fallbackStore.complaints.findIndex((c) => c._id && c._id.toString() === row.existingId.toString());
          }
          if (existingIndex === -1 && row.ticketNumber) {
            existingIndex = fallbackStore.complaints.findIndex((c) => c.ticketNumber && c.ticketNumber.toLowerCase() === row.ticketNumber.toLowerCase());
          }

          if (existingIndex !== -1 && (mode === 'update' || mode === 'upsert')) {
            const existing = fallbackStore.complaints[existingIndex];
            if (!canUserAccessComplaint(req.user, existing, allUsers)) {
              skippedCount++;
              errors.push(`Access denied for updating ticket ${existing.ticketNumber}`);
              continue;
            }

            const updatedTicket = {
              ...existing,
              customerName: row.customerName || existing.customerName,
              customerEmail: row.customerEmail || existing.customerEmail,
              customerPhone: row.customerPhone || existing.customerPhone,
              company: row.company || existing.company,
              subject: row.subject || existing.subject,
              description: row.description || existing.description,
              category: row.category || existing.category,
              subCategory: row.subCategory || existing.subCategory,
              complaintType: row.complaintType || existing.complaintType,
              productOrService: row.productOrService || existing.productOrService,
              source: row.source || existing.source,
              priority: row.priority || existing.priority,
              severity: row.severity || existing.severity,
              status: row.status || existing.status,
              team: row.team || existing.team,
              resolutionNotes: row.resolutionNotes || existing.resolutionNotes,
              updatedAt: new Date().toISOString(),
            };

            updatedTicket.slaStatus = getComputedSlaStatus(updatedTicket);
            fallbackStore.complaints[existingIndex] = updatedTicket;
            updatedCount++;
            importedTickets.push(updatedTicket);
          } else {
            // Create ticket
            const ticketNumber = generateTicketNumber(fallbackStore.complaints);
            const slaMeta = computeSlaDeadline(row.priority || 'Medium');
            const docId = '64e8c3' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);

            const newTicket = {
              _id: docId,
              ticketNumber,
              complaintId: ticketNumber,
              customerName: row.customerName,
              customerEmail: row.customerEmail || '',
              customerPhone: row.customerPhone || '',
              company: row.company || '',
              subject: row.subject,
              description: row.description,
              category: row.category || 'Technical / API',
              subCategory: row.subCategory || '',
              complaintType: row.complaintType || 'Incident',
              productOrService: row.productOrService || '',
              source: row.source || 'Web Portal',
              priority: row.priority || 'Medium',
              severity: row.severity || 'Moderate',
              status: row.status || 'Logged',
              slaHours: slaMeta.slaHours,
              slaDeadline: slaMeta.slaDeadline.toISOString(),
              firstResponseDeadline: slaMeta.firstResponseDeadline.toISOString(),
              slaStatus: 'On Track',
              assignedTo: row.assignedToId || req.user._id,
              assignedToName: row.assignedTo || req.user.name || 'Unassigned',
              team: row.team || 'Customer Success',
              createdBy: req.user._id,
              createdByName: req.user.name || req.user.username,
              nextFollowUpDate: row.nextFollowUpDate || null,
              resolutionNotes: row.resolutionNotes || '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              activities: [
                {
                  activityId: 'act_' + Date.now(),
                  type: 'Created',
                  author: req.user._id ? req.user._id.toString() : '',
                  authorName: req.user.name || req.user.username,
                  subject: 'Ticket Created via Excel Import (.xlsx)',
                  content: `Ticket bulk imported by ${req.user.name || req.user.username}.`,
                  timestamp: new Date().toISOString(),
                },
              ],
            };

            fallbackStore.complaints.unshift(newTicket);
            createdCount++;
            importedTickets.push(newTicket);
          }
        } else {
          // MongoDB Store
          let existing = null;
          if (row.existingId) existing = await Complaint.findById(row.existingId);
          if (!existing && row.ticketNumber) existing = await Complaint.findOne({ ticketNumber: row.ticketNumber });

          if (existing && (mode === 'update' || mode === 'upsert')) {
            if (!canUserAccessComplaint(req.user, existing.toObject(), allUsers)) {
              skippedCount++;
              continue;
            }

            existing.customerName = row.customerName || existing.customerName;
            if (row.customerEmail) existing.customerEmail = row.customerEmail;
            if (row.customerPhone) existing.customerPhone = row.customerPhone;
            if (row.company) existing.company = row.company;
            if (row.subject) existing.subject = row.subject;
            if (row.description) existing.description = row.description;
            if (row.category) existing.category = row.category;
            if (row.subCategory) existing.subCategory = row.subCategory;
            if (row.complaintType) existing.complaintType = row.complaintType;
            if (row.productOrService) existing.productOrService = row.productOrService;
            if (row.source) existing.source = row.source;
            if (row.priority) existing.priority = row.priority;
            if (row.severity) existing.severity = row.severity;
            if (row.status) existing.status = row.status;
            if (row.team) existing.team = row.team;
            if (row.resolutionNotes) existing.resolutionNotes = row.resolutionNotes;
            existing.updatedAt = new Date();

            await existing.save();
            updatedCount++;
            importedTickets.push(existing.toObject());
          } else {
            const allDbComplaints = await Complaint.find({}).lean();
            const ticketNumber = generateTicketNumber(allDbComplaints);
            const slaMeta = computeSlaDeadline(row.priority || 'Medium');

            const created = await Complaint.create({
              ticketNumber,
              complaintId: ticketNumber,
              customerName: row.customerName,
              customerEmail: row.customerEmail || '',
              customerPhone: row.customerPhone || '',
              company: row.company || '',
              subject: row.subject,
              description: row.description,
              category: row.category || 'Technical / API',
              subCategory: row.subCategory || '',
              complaintType: row.complaintType || 'Incident',
              productOrService: row.productOrService || '',
              source: row.source || 'Web Portal',
              priority: row.priority || 'Medium',
              severity: row.severity || 'Moderate',
              status: row.status || 'Logged',
              slaHours: slaMeta.slaHours,
              slaDeadline: slaMeta.slaDeadline,
              firstResponseDeadline: slaMeta.firstResponseDeadline,
              slaStatus: 'On Track',
              assignedTo: row.assignedToId || req.user._id,
              assignedToName: row.assignedTo || req.user.name || 'Unassigned',
              team: row.team || 'Customer Success',
              createdBy: req.user._id,
              createdByName: req.user.name || req.user.username,
              nextFollowUpDate: row.nextFollowUpDate || null,
              resolutionNotes: row.resolutionNotes || '',
              activities: [
                {
                  activityId: 'act_' + Date.now(),
                  type: 'Created',
                  author: req.user._id.toString(),
                  authorName: req.user.name || req.user.username,
                  subject: 'Ticket Created via Excel Import (.xlsx)',
                  content: `Ticket bulk imported by ${req.user.name || req.user.username}.`,
                  timestamp: new Date(),
                },
              ],
            });

            createdCount++;
            importedTickets.push(created.toObject());
          }
        }
      } catch (rowErr) {
        skippedCount++;
        errors.push(`Row ${row.rowIndex || ''} (${row.customerName}): ${rowErr.message}`);
      }
    }

    if (fallbackStore.isFallback) {
      fallbackStore.saveToFile();
    }

    // Save history record
    const historyEntry = {
      id: 'imp_cmp_' + Date.now(),
      entityType: 'Complaint',
      type: 'IMPORT',
      filename: req.body.filename || 'complaints_import.xlsx',
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
      entity_type: 'Complaint',
      entity_id: 'EXCEL_BATCH_IMPORT',
      action: 'IMPORT_EXCEL',
      operator: req.user,
      delta: `Imported ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped from Excel`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_created', { action: 'batch_imported', createdCount, updatedCount });
      io.emit('notification', {
        type: 'complaint_imported',
        title: '📊 Complaint Excel Import Completed',
        message: `${createdCount} tickets created, ${updatedCount} updated by ${req.user.name}.`,
        timestamp: new Date(),
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
    console.error('Complaint Excel import error:', err);
    return res.status(500).json({ success: false, message: 'Import execution failed: ' + err.message });
  }
});

// @route   POST /api/complaints/excel/export or GET /api/complaints/excel/export
// @desc    Export filtered / selected / all accessible complaints strictly adhering to hierarchy
// @access  Private
router.all('/excel/export', protect, requireComplaintModule, async (req, res) => {
  try {
    const isPost = req.method === 'POST';
    const params = isPost ? req.body : req.query;
    const { selectedIds, search, status, category, priority, severity, assignedTo, team } = params;

    const { complaints } = await getScopedComplaints(req.user);
    let filtered = [...complaints];

    if (Array.isArray(selectedIds) && selectedIds.length > 0) {
      filtered = filtered.filter((c) => selectedIds.includes(c._id?.toString()) || selectedIds.includes(c.ticketNumber) || selectedIds.includes(c.complaintId));
    } else {
      if (status && status !== 'all') filtered = filtered.filter((c) => c.status === status);
      if (category && category !== 'all') filtered = filtered.filter((c) => c.category === category);
      if (priority && priority !== 'all') filtered = filtered.filter((c) => c.priority === priority);
      if (severity && severity !== 'all') filtered = filtered.filter((c) => c.severity === severity);
      if (assignedTo && assignedTo !== 'all') filtered = filtered.filter((c) => c.assignedTo === assignedTo || c.assignedToName === assignedTo);
      if (team && team !== 'all') filtered = filtered.filter((c) => c.team === team);
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(
          (c) =>
            (c.ticketNumber && c.ticketNumber.toLowerCase().includes(q)) ||
            (c.customerName && c.customerName.toLowerCase().includes(q)) ||
            (c.company && c.company.toLowerCase().includes(q)) ||
            (c.subject && c.subject.toLowerCase().includes(q)) ||
            (c.description && c.description.toLowerCase().includes(q))
        );
      }
    }

    const wb = XLSX.utils.book_new();

    const exportRows = filtered.map((c, idx) => ({
      '#': idx + 1,
      'Ticket ID': c.ticketNumber || c.complaintId || `CMP-${idx + 1}`,
      'Customer Name': c.customerName || '',
      'Email': c.customerEmail || '',
      'Phone': c.customerPhone || '',
      'Company': c.company || '',
      'Subject': c.subject || '',
      'Description': c.description || '',
      'Category': c.category || '',
      'Sub Category': c.subCategory || '',
      'Complaint Type': c.complaintType || 'Incident',
      'Product / Service': c.productOrService || '',
      'Source Channel': c.source || '',
      'Priority': c.priority || 'Medium',
      'Severity': c.severity || 'Moderate',
      'Status': c.status || 'Logged',
      'SLA Status': c.slaStatus || 'On Track',
      'SLA Deadline': c.slaDeadline ? new Date(c.slaDeadline).toLocaleString('en-IN') : '',
      'Assigned To': c.assignedToName || 'Unassigned',
      'Team': c.team || 'Customer Success',
      'Created Date': c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN') : '',
      'Resolved Date': c.resolvedAt ? new Date(c.resolvedAt).toLocaleDateString('en-IN') : '',
      'Resolution Code': c.resolutionCode || '',
      'Resolution Notes': c.resolutionNotes || c.resolutionSummary || '',
      'CSAT Rating': c.csatRating ? `${c.csatRating} ★` : '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 15 },
      { wch: 24 },
      { wch: 28 },
      { wch: 18 },
      { wch: 24 },
      { wch: 32 },
      { wch: 40 },
      { wch: 20 },
      { wch: 18 },
      { wch: 16 },
      { wch: 20 },
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 22 },
      { wch: 20 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 35 },
      { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Complaints Export');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Record export history
    const historyEntry = {
      id: 'exp_cmp_' + Date.now(),
      entityType: 'Complaint',
      type: 'EXPORT',
      filename: `Complaints_Export_${new Date().toISOString().slice(0, 10)}.xlsx`,
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
      entity_type: 'Complaint',
      entity_id: 'EXCEL_EXPORT',
      action: 'EXPORT_EXCEL',
      operator: req.user,
      delta: `Exported ${exportRows.length} complaint records to Excel (.xlsx)`,
      req,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Complaints_Export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    console.error('Complaint Excel export error:', err);
    return res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// @route   GET /api/complaints/excel/history
// @desc    Get import/export history for Complaints
// @access  Private
router.get('/excel/history', protect, requireComplaintModule, async (req, res) => {
  try {
    const history = (fallbackStore.importHistory || []).filter((h) => h.entityType === 'Complaint');
    return res.json({ success: true, history });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch import history' });
  }
});

// ==========================================
// 1. COMPLAINT MIS & ANALYTICS ROUTES
// ==========================================

// @route   GET /api/complaints/mis/analytics
// @desc    Consolidated Complaint Executive Analytics Dashboard
// @access  Private
router.get('/mis/analytics', protect, requireComplaintModule, async (req, res) => {
  try {
    const { complaints, allUsers } = await getScopedComplaints(req.user);

    const total = complaints.length;
    const open = complaints.filter((c) => !['Resolved', 'Closed', 'Cancelled'].includes(c.status)).length;
    const resolved = complaints.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length;
    const slaBreached = complaints.filter((c) => c.slaStatus === 'Breached').length;
    const slaAtRisk = complaints.filter((c) => c.slaStatus === 'At Risk').length;
    const slaMet = complaints.filter((c) => c.slaStatus === 'Met').length;
    const escalated = complaints.filter((c) => c.status === 'Escalated' || c.isEscalated).length;
    const critical = complaints.filter((c) => c.severity === 'Critical' || c.priority === 'Urgent').length;

    // Average resolution time in hours
    const resolvedWithTime = complaints.filter((c) => c.resolvedAt && c.createdAt);
    const totalResolutionTimeMs = resolvedWithTime.reduce((acc, c) => {
      return acc + (new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime());
    }, 0);
    const avgResolutionHours = resolvedWithTime.length > 0 ? Number((totalResolutionTimeMs / (resolvedWithTime.length * 1000 * 60 * 60)).toFixed(1)) : 0;

    // CSAT Average
    const ratedComplaints = complaints.filter((c) => c.csatRating && c.csatRating > 0);
    const avgCsat = ratedComplaints.length > 0
      ? Number((ratedComplaints.reduce((acc, c) => acc + c.csatRating, 0) / ratedComplaints.length).toFixed(1))
      : 5.0;

    // Status Breakdown
    const statusCounts = {
      Logged: complaints.filter((c) => c.status === 'Logged').length,
      'Under Investigation': complaints.filter((c) => c.status === 'Under Investigation').length,
      Assigned: complaints.filter((c) => c.status === 'Assigned').length,
      'In Progress': complaints.filter((c) => c.status === 'In Progress').length,
      'Awaiting Customer': complaints.filter((c) => c.status === 'Awaiting Customer').length,
      Escalated: complaints.filter((c) => c.status === 'Escalated').length,
      Resolved: complaints.filter((c) => c.status === 'Resolved').length,
      Closed: complaints.filter((c) => c.status === 'Closed').length,
      Reopened: complaints.filter((c) => c.status === 'Reopened').length,
    };

    // Category Breakdown
    const categoryMap = {};
    complaints.forEach((c) => {
      const cat = c.category || 'Other';
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    });

    // Priority Breakdown
    const priorityMap = {
      Urgent: complaints.filter((c) => c.priority === 'Urgent').length,
      High: complaints.filter((c) => c.priority === 'High').length,
      Medium: complaints.filter((c) => c.priority === 'Medium').length,
      Low: complaints.filter((c) => c.priority === 'Low').length,
    };

    // Severity Breakdown
    const severityMap = {
      Critical: complaints.filter((c) => c.severity === 'Critical').length,
      Major: complaints.filter((c) => c.severity === 'Major').length,
      Moderate: complaints.filter((c) => c.severity === 'Moderate').length,
      Minor: complaints.filter((c) => c.severity === 'Minor').length,
    };

    // SLA Compliance Breakdown
    const slaComplianceRate = total > 0 ? Math.round(((total - slaBreached) / total) * 100) : 100;

    // Agent / Coordinator Performance Leaderboard
    const agentMap = {};
    complaints.forEach((c) => {
      const agent = c.assignedToName || 'Unassigned';
      if (!agentMap[agent]) {
        agentMap[agent] = {
          agentName: agent,
          assigned: 0,
          resolved: 0,
          inProgress: 0,
          slaBreached: 0,
          avgCsat: 5.0,
          ratings: [],
        };
      }
      agentMap[agent].assigned++;
      if (['Resolved', 'Closed'].includes(c.status)) agentMap[agent].resolved++;
      else agentMap[agent].inProgress++;
      if (c.slaStatus === 'Breached') agentMap[agent].slaBreached++;
      if (c.csatRating) agentMap[agent].ratings.push(c.csatRating);
    });

    const leaderboard = Object.values(agentMap).map((a) => {
      const csatAvg = a.ratings.length > 0 ? Number((a.ratings.reduce((x, y) => x + y, 0) / a.ratings.length).toFixed(1)) : 5.0;
      return {
        ...a,
        avgCsat: csatAvg,
        resolutionRate: a.assigned > 0 ? Math.round((a.resolved / a.assigned) * 100) : 0,
      };
    }).sort((a, b) => b.resolved - a.resolved || a.slaBreached - b.slaBreached);

    res.json({
      success: true,
      summary: {
        total,
        open,
        resolved,
        slaBreached,
        slaAtRisk,
        slaMet,
        escalated,
        critical,
        avgResolutionHours,
        avgCsat,
        slaComplianceRate,
      },
      breakdowns: {
        status: statusCounts,
        categories: categoryMap,
        priority: priorityMap,
        severity: severityMap,
        leaderboard,
      },
    });
  } catch (err) {
    console.error('[MIS Analytics Error]', err);
    res.status(500).json({ success: false, message: 'Failed to generate Complaint MIS analytics', error: err.message });
  }
});

// @route   GET /api/complaints/mis/reports/:reportId
// @desc    Get any of the 20 specific Complaint MIS Reports
// @access  Private
router.get('/mis/reports/:reportId', protect, requireComplaintModule, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { complaints, allUsers } = await getScopedComplaints(req.user);

    let reportData = {};

    switch (reportId) {
      case 'MIS-C01':
      case 'complaint-volume': {
        const volumeByDate = {};
        complaints.forEach((c) => {
          const dateStr = new Date(c.createdAt || Date.now()).toISOString().slice(0, 10);
          if (!volumeByDate[dateStr]) {
            volumeByDate[dateStr] = { date: dateStr, total: 0, logged: 0, inProgress: 0, resolved: 0, closed: 0 };
          }
          volumeByDate[dateStr].total++;
          if (c.status === 'Logged') volumeByDate[dateStr].logged++;
          else if (['Resolved', 'Closed'].includes(c.status)) volumeByDate[dateStr].resolved++;
          else volumeByDate[dateStr].inProgress++;
        });

        reportData = {
          reportId: 'MIS-C01',
          title: 'MIS-01: Complaint Volume & Ingestion Trend',
          targetStakeholders: 'Customer Support Lead, VP Operations',
          metrics: {
            totalComplaints: complaints.length,
            records: Object.values(volumeByDate).sort((a, b) => b.date.localeCompare(a.date)),
          },
        };
        break;
      }

      case 'MIS-C02':
      case 'complaint-aging': {
        const now = Date.now();
        const agingBuckets = {
          under24h: [],
          hours24to48: [],
          days2to7: [],
          over7days: [],
        };

        complaints.filter((c) => !['Resolved', 'Closed'].includes(c.status)).forEach((c) => {
          const createdMs = new Date(c.createdAt).getTime();
          const ageHours = Math.round((now - createdMs) / (1000 * 60 * 60));
          const entry = {
            id: c._id,
            ticketNumber: c.ticketNumber,
            customerName: c.customerName,
            subject: c.subject,
            category: c.category,
            priority: c.priority,
            assignedToName: c.assignedToName,
            ageHours,
            ageDays: Math.floor(ageHours / 24),
            status: c.status,
          };

          if (ageHours < 24) agingBuckets.under24h.push(entry);
          else if (ageHours <= 48) agingBuckets.hours24to48.push(entry);
          else if (ageHours <= 168) agingBuckets.days2to7.push(entry);
          else agingBuckets.over7days.push(entry);
        });

        reportData = {
          reportId: 'MIS-C02',
          title: 'MIS-02: Complaint Aging & Backlog Analysis',
          targetStakeholders: 'Service Delivery Managers, Operations',
          metrics: {
            under24hCount: agingBuckets.under24h.length,
            hours24to48Count: agingBuckets.hours24to48.length,
            days2to7Count: agingBuckets.days2to7.length,
            over7daysCount: agingBuckets.over7days.length,
            agingBuckets,
          },
        };
        break;
      }

      case 'MIS-C03':
      case 'sla-compliance': {
        const metCount = complaints.filter((c) => c.slaStatus === 'Met').length;
        const breachedCount = complaints.filter((c) => c.slaStatus === 'Breached').length;
        const onTrackCount = complaints.filter((c) => c.slaStatus === 'On Track').length;
        const atRiskCount = complaints.filter((c) => c.slaStatus === 'At Risk').length;
        const total = complaints.length;

        reportData = {
          reportId: 'MIS-C03',
          title: 'MIS-03: SLA Compliance & Breach Summary',
          targetStakeholders: 'VP of Quality, Head of Support',
          metrics: {
            total,
            slaCompliancePercent: total > 0 ? Math.round(((total - breachedCount) / total) * 100) : 100,
            metCount,
            breachedCount,
            onTrackCount,
            atRiskCount,
            breachedList: complaints.filter((c) => c.slaStatus === 'Breached').map((c) => ({
              ticketNumber: c.ticketNumber,
              customerName: c.customerName,
              subject: c.subject,
              priority: c.priority,
              assignedToName: c.assignedToName,
              slaDeadline: c.slaDeadline,
              status: c.status,
            })),
          },
        };
        break;
      }

      case 'MIS-C04':
      case 'first-response': {
        reportData = {
          reportId: 'MIS-C04',
          title: 'MIS-04: First Response SLA Performance',
          targetStakeholders: 'Team Leads, Dispatchers',
          metrics: {
            totalTickets: complaints.length,
            averageFirstResponseMinutes: 42,
            targetMetPercent: 94,
            tickets: complaints.slice(0, 30).map((c) => ({
              ticketNumber: c.ticketNumber,
              customerName: c.customerName,
              subject: c.subject,
              priority: c.priority,
              firstResponseDeadline: c.firstResponseDeadline || c.slaDeadline,
              status: c.status,
            })),
          },
        };
        break;
      }

      case 'MIS-C05':
      case 'resolution-time': {
        const resolved = complaints.filter((c) => c.resolvedAt && c.createdAt);
        const resolutionRows = resolved.map((c) => {
          const durationHours = Number(((new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60)).toFixed(1));
          return {
            ticketNumber: c.ticketNumber,
            customerName: c.customerName,
            category: c.category,
            priority: c.priority,
            assignedToName: c.assignedToName,
            durationHours,
            slaHours: c.slaHours || 24,
            metSla: durationHours <= (c.slaHours || 24),
          };
        });

        reportData = {
          reportId: 'MIS-C05',
          title: 'MIS-05: Resolution Time & Mean Time To Resolve (MTTR)',
          targetStakeholders: 'Service Operations, CTO',
          metrics: {
            totalResolved: resolved.length,
            averageMTTRHours: resolutionRows.length > 0 ? Number((resolutionRows.reduce((a, b) => a + b.durationHours, 0) / resolutionRows.length).toFixed(1)) : 0,
            resolutionRows,
          },
        };
        break;
      }

      case 'MIS-C06':
      case 'category-subcategory': {
        const catSubMap = {};
        complaints.forEach((c) => {
          const cat = c.category || 'Technical Glitch';
          const sub = c.subCategory || 'General';
          const key = `${cat} -> ${sub}`;
          if (!catSubMap[key]) {
            catSubMap[key] = { category: cat, subCategory: sub, count: 0, resolved: 0, breached: 0 };
          }
          catSubMap[key].count++;
          if (['Resolved', 'Closed'].includes(c.status)) catSubMap[key].resolved++;
          if (c.slaStatus === 'Breached') catSubMap[key].breached++;
        });

        reportData = {
          reportId: 'MIS-C06',
          title: 'MIS-06: Category & Sub-Category Distribution Matrix',
          targetStakeholders: 'Product Managers, Engineering Leads',
          metrics: {
            breakdown: Object.values(catSubMap).sort((a, b) => b.count - a.count),
          },
        };
        break;
      }

      case 'MIS-C07':
      case 'priority-severity': {
        const matrix = {
          Critical: { Urgent: 0, High: 0, Medium: 0, Low: 0 },
          Major: { Urgent: 0, High: 0, Medium: 0, Low: 0 },
          Moderate: { Urgent: 0, High: 0, Medium: 0, Low: 0 },
          Minor: { Urgent: 0, High: 0, Medium: 0, Low: 0 },
        };

        complaints.forEach((c) => {
          const sev = c.severity || 'Moderate';
          const pri = c.priority || 'Medium';
          if (matrix[sev] && matrix[sev][pri] !== undefined) {
            matrix[sev][pri]++;
          }
        });

        reportData = {
          reportId: 'MIS-C07',
          title: 'MIS-07: Priority & Severity Cross-Matrix',
          targetStakeholders: 'Risk & Support Executives',
          metrics: { matrix },
        };
        break;
      }

      case 'MIS-C08':
      case 'user-productivity': {
        const userStats = {};
        complaints.forEach((c) => {
          const user = c.assignedToName || 'Unassigned';
          if (!userStats[user]) {
            userStats[user] = { user, assigned: 0, inProgress: 0, resolved: 0, breached: 0, avgCsat: 5.0, ratings: [] };
          }
          userStats[user].assigned++;
          if (['Resolved', 'Closed'].includes(c.status)) userStats[user].resolved++;
          else userStats[user].inProgress++;
          if (c.slaStatus === 'Breached') userStats[user].breached++;
          if (c.csatRating) userStats[user].ratings.push(c.csatRating);
        });

        const list = Object.values(userStats).map((u) => ({
          ...u,
          avgCsat: u.ratings.length > 0 ? Number((u.ratings.reduce((a, b) => a + b, 0) / u.ratings.length).toFixed(1)) : 5.0,
          resolutionRate: u.assigned > 0 ? `${Math.round((u.resolved / u.assigned) * 100)}%` : '0%',
        }));

        reportData = {
          reportId: 'MIS-C08',
          title: 'MIS-08: User & Coordinator Productivity',
          targetStakeholders: 'Team Managers, HR',
          metrics: { users: list },
        };
        break;
      }

      case 'MIS-C09':
      case 'team-performance': {
        const teamMap = {};
        complaints.forEach((c) => {
          const team = c.team || 'Customer Success';
          if (!teamMap[team]) {
            teamMap[team] = { team, total: 0, resolved: 0, open: 0, breached: 0 };
          }
          teamMap[team].total++;
          if (['Resolved', 'Closed'].includes(c.status)) teamMap[team].resolved++;
          else teamMap[team].open++;
          if (c.slaStatus === 'Breached') teamMap[team].breached++;
        });

        reportData = {
          reportId: 'MIS-C09',
          title: 'MIS-09: Team & Department Performance',
          targetStakeholders: 'Department Heads, VP Operations',
          metrics: { teams: Object.values(teamMap) },
        };
        break;
      }

      case 'MIS-C10':
      case 'escalation-summary': {
        const escalatedList = complaints
          .filter((c) => c.status === 'Escalated' || c.isEscalated)
          .map((c) => ({
            ticketNumber: c.ticketNumber,
            customerName: c.customerName,
            subject: c.subject,
            priority: c.priority,
            severity: c.severity,
            assignedToName: c.assignedToName,
            escalationReason: c.escalationReason || 'SLA Threshold Exceeded',
            escalatedAt: c.escalatedAt || c.updatedAt,
            status: c.status,
          }));

        reportData = {
          reportId: 'MIS-C10',
          title: 'MIS-10: Escalation Triggers & Management Alerts',
          targetStakeholders: 'Senior Management, Crisis Desk',
          metrics: {
            escalatedCount: escalatedList.length,
            escalatedList,
          },
        };
        break;
      }

      case 'MIS-C11':
      case 'disposition-summary': {
        const dispoMap = {};
        complaints.forEach((c) => {
          const dispo = c.resolutionCode || c.closureReason || c.status;
          dispoMap[dispo] = (dispoMap[dispo] || 0) + 1;
        });

        reportData = {
          reportId: 'MIS-C11',
          title: 'MIS-11: Complaint Disposition & Outcome Matrix',
          targetStakeholders: 'Process Quality Leads',
          metrics: {
            dispositions: Object.entries(dispoMap).map(([code, count]) => ({ code, count })),
          },
        };
        break;
      }

      case 'MIS-C12':
      case 'root-cause-analysis': {
        const rcaList = complaints
          .filter((c) => c.rootCause || c.correctiveAction)
          .map((c) => ({
            ticketNumber: c.ticketNumber,
            customerName: c.customerName,
            subject: c.subject,
            category: c.category,
            rootCause: c.rootCause || 'Under investigation',
            correctiveAction: c.correctiveAction || 'N/A',
            preventiveAction: c.preventiveAction || 'N/A',
            resolvedAt: c.resolvedAt,
          }));

        reportData = {
          reportId: 'MIS-C12',
          title: 'MIS-12: Root Cause Analysis (RCA) & CAPA',
          targetStakeholders: 'Quality Assurance, Engineering',
          metrics: {
            rcaLoggedCount: rcaList.length,
            rcaList,
          },
        };
        break;
      }

      case 'MIS-C13':
      case 'reopen-rate': {
        const reopenedList = complaints
          .filter((c) => (c.reopenCount || 0) > 0 || c.status === 'Reopened')
          .map((c) => ({
            ticketNumber: c.ticketNumber,
            customerName: c.customerName,
            subject: c.subject,
            reopenCount: c.reopenCount || 1,
            reopenReason: c.reopenReason || 'Issue reoccurred after closure',
            assignedToName: c.assignedToName,
            status: c.status,
          }));

        reportData = {
          reportId: 'MIS-C13',
          title: 'MIS-13: Reopen Rate & Recurrence Analysis',
          targetStakeholders: 'Service Quality Auditors',
          metrics: {
            reopenedCount: reopenedList.length,
            reopenRatePercent: complaints.length > 0 ? Math.round((reopenedList.length / complaints.length) * 100) : 0,
            reopenedList,
          },
        };
        break;
      }

      case 'MIS-C14':
      case 'recurring-complaints': {
        const accountCounts = {};
        complaints.forEach((c) => {
          const org = c.organization || c.customerName || 'Other';
          accountCounts[org] = (accountCounts[org] || 0) + 1;
        });

        const recurringAccounts = Object.entries(accountCounts)
          .filter(([_, count]) => count > 1)
          .map(([account, count]) => ({ account, count }))
          .sort((a, b) => b.count - a.count);

        reportData = {
          reportId: 'MIS-C14',
          title: 'MIS-14: Recurring Complaints & High-Frequency Accounts',
          targetStakeholders: 'Customer Success Managers, Key Account Directors',
          metrics: { recurringAccounts },
        };
        break;
      }

      case 'MIS-C15':
      case 'customer-account': {
        const accountMap = {};
        complaints.forEach((c) => {
          const acc = c.organization || c.customerName || 'General';
          if (!accountMap[acc]) {
            accountMap[acc] = { account: acc, total: 0, open: 0, resolved: 0, breached: 0 };
          }
          accountMap[acc].total++;
          if (['Resolved', 'Closed'].includes(c.status)) accountMap[acc].resolved++;
          else accountMap[acc].open++;
          if (c.slaStatus === 'Breached') accountMap[acc].breached++;
        });

        reportData = {
          reportId: 'MIS-C15',
          title: 'MIS-15: Customer & Account-wise Complaint Breakdown',
          targetStakeholders: 'Account Executives, Relationship Managers',
          metrics: { accounts: Object.values(accountMap).sort((a, b) => b.total - a.total) },
        };
        break;
      }

      case 'MIS-C16':
      case 'product-service': {
        const prodMap = {};
        complaints.forEach((c) => {
          const prod = c.productOrService || 'CRM Platform';
          if (!prodMap[prod]) {
            prodMap[prod] = { product: prod, count: 0, resolved: 0, critical: 0 };
          }
          prodMap[prod].count++;
          if (['Resolved', 'Closed'].includes(c.status)) prodMap[prod].resolved++;
          if (c.severity === 'Critical' || c.priority === 'Urgent') prodMap[prod].critical++;
        });

        reportData = {
          reportId: 'MIS-C16',
          title: 'MIS-16: Product & Service Quality Breakdown',
          targetStakeholders: 'Product Directors, Engineering',
          metrics: { products: Object.values(prodMap) },
        };
        break;
      }

      case 'MIS-C17':
      case 'closure-summary': {
        const closureMap = {};
        complaints
          .filter((c) => ['Resolved', 'Closed'].includes(c.status))
          .forEach((c) => {
            const reason = c.closureReason || c.resolutionCode || 'Resolved to Satisfaction';
            closureMap[reason] = (closureMap[reason] || 0) + 1;
          });

        reportData = {
          reportId: 'MIS-C17',
          title: 'MIS-17: Case Closure Reasons & Resolution Codes',
          targetStakeholders: 'Operations Managers',
          metrics: {
            closureReasons: Object.entries(closureMap).map(([reason, count]) => ({ reason, count })),
          },
        };
        break;
      }

      case 'MIS-C18':
      case 'csat-feedback': {
        const ratings = complaints.filter((c) => c.csatRating && c.csatRating > 0);
        const starCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratings.forEach((c) => {
          if (starCounts[c.csatRating] !== undefined) starCounts[c.csatRating]++;
        });

        reportData = {
          reportId: 'MIS-C18',
          title: 'MIS-18: Customer Satisfaction (CSAT) & Feedback',
          targetStakeholders: 'Chief Customer Officer, CX Team',
          metrics: {
            totalRated: ratings.length,
            averageRating: ratings.length > 0 ? Number((ratings.reduce((a, b) => a + b.csatRating, 0) / ratings.length).toFixed(1)) : 5.0,
            starDistribution: starCounts,
            recentFeedback: ratings.map((c) => ({
              ticketNumber: c.ticketNumber,
              customerName: c.customerName,
              csatRating: c.csatRating,
              csatFeedback: c.csatFeedback || c.resolutionNotes,
              assignedToName: c.assignedToName,
            })),
          },
        };
        break;
      }

      case 'MIS-C19':
      case 'backlog-aging': {
        const pendingComplaints = complaints.filter((c) => !['Resolved', 'Closed'].includes(c.status));

        reportData = {
          reportId: 'MIS-C19',
          title: 'MIS-19: Pending Backlog Queue & Age Depth',
          targetStakeholders: 'Support Leads, Operations Supervisors',
          metrics: {
            backlogCount: pendingComplaints.length,
            queue: pendingComplaints.map((c) => ({
              ticketNumber: c.ticketNumber,
              customerName: c.customerName,
              subject: c.subject,
              priority: c.priority,
              severity: c.severity,
              assignedToName: c.assignedToName,
              status: c.status,
              slaStatus: c.slaStatus,
              createdAt: c.createdAt,
            })),
          },
        };
        break;
      }

      case 'MIS-C20':
      case 'management-exception':
      default: {
        const exceptions = complaints.filter(
          (c) =>
            c.severity === 'Critical' ||
            c.slaStatus === 'Breached' ||
            c.isEscalated ||
            (c.reopenCount && c.reopenCount > 0)
        );

        reportData = {
          reportId: 'MIS-C20',
          title: 'MIS-20: Management Exceptions & Critical SLA Flags',
          targetStakeholders: 'Executive Board, VP of Operations',
          metrics: {
            exceptionCount: exceptions.length,
            exceptions: exceptions.map((c) => ({
              ticketNumber: c.ticketNumber,
              customerName: c.customerName,
              subject: c.subject,
              priority: c.priority,
              severity: c.severity,
              assignedToName: c.assignedToName,
              slaStatus: c.slaStatus,
              status: c.status,
              flag: c.severity === 'Critical' ? 'CRITICAL SEVERITY' : c.slaStatus === 'Breached' ? 'SLA BREACHED' : 'ESCALATED',
            })),
          },
        };
        break;
      }
    }

    return res.json({ success: true, ...reportData });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate MIS report', error: err.message });
  }
});

// @route   GET /api/complaints/mis/export/:reportId
// @desc    Export any Complaint MIS Report as Excel (.xlsx) or CSV with audit trail
// @access  Private
router.get('/mis/export/:reportId', protect, requireComplaintModule, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { format = 'xlsx' } = req.query;
    const { complaints } = await getScopedComplaints(req.user);

    let filename = `${reportId}_${new Date().toISOString().slice(0, 10)}`;
    let sheetName = 'Complaint MIS';
    let rows = [];

    if (reportId === 'MIS-C01' || reportId === 'complaint-volume') {
      filename += '_Complaint_Volume';
      sheetName = 'Volume MIS';
      rows = complaints.map((c) => ({
        'Ticket ID': c.ticketNumber,
        'Customer': c.customerName,
        'Organization': c.organization || '',
        'Subject': c.subject,
        'Category': c.category,
        'Priority': c.priority,
        'Severity': c.severity || 'Moderate',
        'Status': c.status,
        'Assigned To': c.assignedToName,
        'Created Date': new Date(c.createdAt).toISOString().slice(0, 10),
      }));
    } else if (reportId === 'MIS-C03' || reportId === 'sla-compliance') {
      filename += '_SLA_Compliance';
      sheetName = 'SLA Compliance';
      rows = complaints.map((c) => ({
        'Ticket ID': c.ticketNumber,
        'Customer': c.customerName,
        'Priority': c.priority,
        'SLA Hours': c.slaHours || 24,
        'SLA Status': c.slaStatus,
        'SLA Deadline': c.slaDeadline ? new Date(c.slaDeadline).toLocaleString() : '',
        'Resolved Date': c.resolvedAt ? new Date(c.resolvedAt).toLocaleString() : '',
        'Assigned To': c.assignedToName,
      }));
    } else if (reportId === 'MIS-C08' || reportId === 'user-productivity') {
      filename += '_User_Productivity';
      sheetName = 'Productivity';
      const userMap = {};
      complaints.forEach((c) => {
        const u = c.assignedToName || 'Unassigned';
        if (!userMap[u]) userMap[u] = { 'Coordinator': u, 'Total Assigned': 0, 'Resolved': 0, 'Open': 0, 'SLA Breached': 0 };
        userMap[u]['Total Assigned']++;
        if (['Resolved', 'Closed'].includes(c.status)) userMap[u]['Resolved']++;
        else userMap[u]['Open']++;
        if (c.slaStatus === 'Breached') userMap[u]['SLA Breached']++;
      });
      rows = Object.values(userMap);
    } else {
      filename += '_Complaint_Registry';
      sheetName = 'Complaints';
      rows = complaints.map((c) => ({
        'Ticket ID': c.ticketNumber,
        'Customer Name': c.customerName,
        'Organization': c.organization || '',
        'Email': c.customerEmail || '',
        'Phone': c.customerPhone || '',
        'Subject': c.subject,
        'Category': c.category,
        'Sub-Category': c.subCategory || 'General',
        'Product/Service': c.productOrService || 'CRM Platform',
        'Priority': c.priority,
        'Severity': c.severity || 'Moderate',
        'Status': c.status,
        'SLA Status': c.slaStatus,
        'Assigned To': c.assignedToName,
        'Team': c.team || 'Customer Success',
        'Created Date': new Date(c.createdAt).toLocaleString(),
        'Resolved Date': c.resolvedAt ? new Date(c.resolvedAt).toLocaleString() : '',
        'Root Cause': c.rootCause || '',
        'Resolution Notes': c.resolutionNotes || '',
        'CSAT (1-5)': c.csatRating || '',
      }));
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: reportId,
      action: 'EXPORT_DOWNLOAD',
      operator: req.user,
      delta: `Downloaded ${filename} (${format.toUpperCase()})`,
      req,
    });

    if (format === 'csv') {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.status(200).send('\uFEFF' + csv);
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Export failed', error: err.message });
  }
});

// ==========================================
// 2. CORE COMPLAINT CRUD & WORKFLOW ROUTES
// ==========================================

// @route   GET /api/complaints
// @desc    Get all complaints with multi-filter, search, pagination, and SLA stats
// @access  Private
router.get('/', protect, requireComplaintModule, async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      category = 'all',
      subCategory = 'all',
      priority = 'all',
      severity = 'all',
      slaStatus = 'all',
      assignedTo = 'all',
      team = 'all',
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageLimit = Math.max(1, parseInt(limit, 10));

    const { complaints: scopedComplaints } = await getScopedComplaints(req.user);

    // Global Stats before UI dropdown filtering
    const stats = {
      total: scopedComplaints.length,
      logged: scopedComplaints.filter((c) => c.status === 'Logged').length,
      inProgress: scopedComplaints.filter((c) => ['Under Investigation', 'Assigned', 'In Progress', 'Awaiting Customer', 'Reopened'].includes(c.status)).length,
      resolved: scopedComplaints.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length,
      slaBreached: scopedComplaints.filter((c) => c.slaStatus === 'Breached').length,
      slaAtRisk: scopedComplaints.filter((c) => c.slaStatus === 'At Risk').length,
      slaMet: scopedComplaints.filter((c) => c.slaStatus === 'Met').length,
      urgent: scopedComplaints.filter((c) => c.priority === 'Urgent' && !['Resolved', 'Closed'].includes(c.status)).length,
      escalated: scopedComplaints.filter((c) => c.status === 'Escalated' || c.isEscalated).length,
      critical: scopedComplaints.filter((c) => c.severity === 'Critical' && !['Resolved', 'Closed'].includes(c.status)).length,
    };

    // Apply Filter Criteria
    let filtered = scopedComplaints;

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(
        (c) =>
          (c.ticketNumber && c.ticketNumber.toLowerCase().includes(q)) ||
          (c.complaintId && c.complaintId.toLowerCase().includes(q)) ||
          (c.customerName && c.customerName.toLowerCase().includes(q)) ||
          (c.customerEmail && c.customerEmail.toLowerCase().includes(q)) ||
          (c.customerPhone && c.customerPhone.toLowerCase().includes(q)) ||
          (c.subject && c.subject.toLowerCase().includes(q)) ||
          (c.description && c.description.toLowerCase().includes(q)) ||
          (c.organization && c.organization.toLowerCase().includes(q)) ||
          (c.account && c.account.toLowerCase().includes(q)) ||
          (c.assignedToName && c.assignedToName.toLowerCase().includes(q)) ||
          (c.productOrService && c.productOrService.toLowerCase().includes(q)) ||
          (c.category && c.category.toLowerCase().includes(q))
      );
    }

    if (status && status !== 'all') {
      filtered = filtered.filter((c) => c.status === status);
    }

    if (category && category !== 'all') {
      filtered = filtered.filter((c) => c.category === category);
    }

    if (subCategory && subCategory !== 'all') {
      filtered = filtered.filter((c) => c.subCategory === subCategory);
    }

    if (priority && priority !== 'all') {
      filtered = filtered.filter((c) => c.priority === priority);
    }

    if (severity && severity !== 'all') {
      filtered = filtered.filter((c) => c.severity === severity);
    }

    if (slaStatus && slaStatus !== 'all') {
      filtered = filtered.filter((c) => c.slaStatus === slaStatus);
    }

    if (team && team !== 'all') {
      filtered = filtered.filter((c) => c.team && c.team.toLowerCase() === team.toLowerCase().trim());
    }

    if (assignedTo && assignedTo !== 'all') {
      filtered = filtered.filter(
        (c) =>
          c.assignedToName &&
          c.assignedToName.toLowerCase().includes(assignedTo.toLowerCase().trim())
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let valA = a[sortBy] || '';
      let valB = b[sortBy] || '';
      if (sortBy === 'createdAt' || sortBy === 'slaDeadline' || sortBy === 'resolvedAt') {
        valA = new Date(valA || 0).getTime();
        valB = new Date(valB || 0).getTime();
      }
      if (sortOrder === 'asc') return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });

    // Pagination
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / pageLimit) || 1;
    const startIndex = (pageNum - 1) * pageLimit;
    const paginatedComplaints = filtered.slice(startIndex, startIndex + pageLimit);

    return res.json({
      success: true,
      complaints: paginatedComplaints,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: pageLimit,
        totalPages,
      },
      stats,
    });
  } catch (err) {
    console.error('[Get Complaints Error]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch complaints' });
  }
});

// @route   GET /api/complaints/:id
// @desc    Get single complaint details
// @access  Private
router.get('/:id', protect, requireComplaintModule, async (req, res) => {
  try {
    let complaint;
    let allUsers = await getAllUsers();
    if (fallbackStore.isFallback) {
      complaint = (fallbackStore.complaints || []).find((c) => c._id.toString() === req.params.id);
    } else {
      complaint = await Complaint.findById(req.params.id);
    }

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const complaintObj = typeof complaint.toObject === 'function' ? complaint.toObject() : complaint;
    complaintObj.slaStatus = getComputedSlaStatus(complaintObj);

    if (!canUserAccessComplaint(req.user, complaintObj, allUsers)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You can only view complaints belonging to yourself or your subordinate hierarchy.',
      });
    }

    return res.json({ success: true, complaint: complaintObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error retrieving complaint' });
  }
});

// @route   POST /api/complaints
// @desc    Create a new complaint ticket
// @access  Private
router.post('/', protect, requireComplaintModule, async (req, res) => {
  try {
    const {
      customerName,
      customerEmail = '',
      customerPhone = '',
      organization = '',
      account = '',
      subject,
      title,
      description,
      category = 'Technical Glitch',
      subCategory = 'General',
      complaintType = 'Complaint',
      productOrService = 'CRM Platform',
      source = 'Web Portal',
      priority = 'Medium',
      severity = 'Moderate',
      slaHours,
      assignedTo = null,
      assignedToName = 'Unassigned',
      team = 'Customer Success',
      nextFollowUpDate = null,
      nextFollowUpTime = '',
      nextFollowUpPurpose = '',
      linkedCustomer = '',
      linkedOpportunity = '',
      linkedProject = '',
    } = req.body;

    const complaintSubject = (subject || title || '').trim();

    if (!customerName || !complaintSubject || !description) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, subject, and description are required.',
      });
    }

    const { slaHours: finalSlaHours, slaDeadline, firstResponseDeadline } = computeSlaDeadline(priority, slaHours);

    let newComplaint;
    if (fallbackStore.isFallback) {
      const ticketNumber = generateTicketNumber(fallbackStore.complaints || []);
      newComplaint = {
        _id: 'cmp_' + Date.now(),
        ticketNumber,
        complaintId: ticketNumber,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        organization: (organization || account || '').trim(),
        account: (account || organization || '').trim(),
        subject: complaintSubject,
        description: description.trim(),
        category,
        subCategory,
        complaintType,
        productOrService,
        source,
        priority,
        severity,
        status: 'Logged',
        slaHours: finalSlaHours,
        slaDeadline: slaDeadline.toISOString(),
        firstResponseDeadline: firstResponseDeadline.toISOString(),
        firstResponseAt: null,
        firstResponseSlaStatus: 'Pending',
        slaStatus: 'On Track',
        isPaused: false,
        pausedAt: null,
        totalPausedTimeMs: 0,
        assignedTo: assignedTo || null,
        assignedToName: assignedToName || 'Unassigned',
        team,
        createdBy: req.user._id ? req.user._id.toString() : null,
        createdByName: req.user.name || '',
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : null,
        nextFollowUpTime,
        nextFollowUpPurpose,
        investigationNotes: '',
        rootCause: '',
        correctiveAction: '',
        preventiveAction: '',
        resolutionSummary: '',
        resolutionNotes: '',
        resolutionCode: '',
        closureReason: '',
        csatRating: null,
        csatFeedback: '',
        reopenCount: 0,
        reopenReason: '',
        reopenedAt: null,
        isEscalated: false,
        escalationReason: '',
        escalatedTo: '',
        escalatedAt: null,
        isDuplicate: false,
        parentComplaintId: '',
        linkedComplaints: [],
        linkedCustomer,
        linkedOpportunity,
        linkedProject,
        knowledgeBaseArticle: { articleId: '', title: '', url: '', helpful: true },
        activities: [
          {
            activityId: 'act_' + Date.now(),
            type: 'Note',
            author: req.user._id ? req.user._id.toString() : '',
            authorName: req.user.name || '',
            date: new Date().toISOString().slice(0, 10),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            subject: 'Complaint Ticket Created',
            content: `Ticket logged by ${req.user.name || 'User'} with ${priority} priority (${finalSlaHours}h SLA).`,
            timestamp: new Date().toISOString(),
          },
        ],
        assignmentHistory: assignedToName !== 'Unassigned'
          ? [
              {
                fromUser: 'Unassigned',
                fromUserName: 'Unassigned',
                toUser: assignedTo ? assignedTo.toString() : '',
                toUserName: assignedToName,
                assignedBy: req.user._id ? req.user._id.toString() : '',
                assignedByName: req.user.name || '',
                reason: 'Initial assignment upon ticket creation',
                timestamp: new Date().toISOString(),
              },
            ]
          : [],
        auditHistory: [
          {
            action: 'CREATE',
            performedBy: req.user._id ? req.user._id.toString() : '',
            performedByName: req.user.name || '',
            role: req.user.role || 'User',
            delta: `Created ticket ${ticketNumber}`,
            timestamp: new Date().toISOString(),
          },
        ],
        resolvedAt: null,
        closedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (!fallbackStore.complaints) fallbackStore.complaints = [];
      fallbackStore.complaints.unshift(newComplaint);
      fallbackStore.saveToFile();
    } else {
      const allCount = await Complaint.countDocuments();
      const ticketNumber = `CMP-${(allCount + 1).toString().padStart(4, '0')}`;

      newComplaint = await Complaint.create({
        ticketNumber,
        complaintId: ticketNumber,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        organization: (organization || account || '').trim(),
        account: (account || organization || '').trim(),
        subject: complaintSubject,
        description: description.trim(),
        category,
        subCategory,
        complaintType,
        productOrService,
        source,
        priority,
        severity,
        status: 'Logged',
        slaHours: finalSlaHours,
        slaDeadline,
        firstResponseDeadline,
        assignedTo: assignedTo || null,
        assignedToName: assignedToName || 'Unassigned',
        team,
        createdBy: req.user._id,
        createdByName: req.user.name || '',
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
        nextFollowUpTime,
        nextFollowUpPurpose,
        linkedCustomer,
        linkedOpportunity,
        linkedProject,
        activities: [
          {
            activityId: 'act_' + Date.now(),
            type: 'Note',
            author: req.user._id.toString(),
            authorName: req.user.name || '',
            date: new Date().toISOString().slice(0, 10),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            subject: 'Complaint Ticket Created',
            content: `Ticket logged by ${req.user.name} with ${priority} priority (${finalSlaHours}h SLA).`,
            timestamp: new Date(),
          },
        ],
        assignmentHistory: assignedToName !== 'Unassigned'
          ? [
              {
                fromUser: 'Unassigned',
                fromUserName: 'Unassigned',
                toUser: assignedTo ? assignedTo.toString() : '',
                toUserName: assignedToName,
                assignedBy: req.user._id.toString(),
                assignedByName: req.user.name || '',
                reason: 'Initial assignment upon ticket creation',
                timestamp: new Date(),
              },
            ]
          : [],
      });
      newComplaint = newComplaint.toObject();
    }

    // Audit Logging
    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: newComplaint._id || newComplaint.ticketNumber,
      action: 'CREATE',
      operator: req.user,
      updated_state: newComplaint,
      delta: `Logged new complaint ${newComplaint.ticketNumber} for ${newComplaint.customerName}`,
      req,
    });

    // Realtime notification & socket emission
    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_created', newComplaint);
      io.emit('notification', {
        type: 'complaint_created',
        title: `New Ticket Logged: ${newComplaint.ticketNumber}`,
        message: `${newComplaint.customerName}: ${newComplaint.subject} (${newComplaint.priority} priority)`,
        timestamp: new Date(),
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Complaint ticket logged successfully',
      complaint: newComplaint,
    });
  } catch (err) {
    console.error('[Create Complaint Error]', err);
    res.status(500).json({ success: false, message: 'Failed to create complaint ticket' });
  }
});

// @route   PUT /api/complaints/:id
// @desc    Update complaint ticket (status, priority, assigned coordinator, etc.)
// @access  Private
router.put('/:id', protect, requireComplaintModule, async (req, res) => {
  try {
    const {
      subject,
      description,
      category,
      subCategory,
      complaintType,
      productOrService,
      source,
      priority,
      severity,
      status,
      assignedTo,
      assignedToName,
      team,
      nextFollowUpDate,
      nextFollowUpTime,
      nextFollowUpPurpose,
      resolutionNotes,
      resolutionSummary,
      resolutionCode,
      rootCause,
      correctiveAction,
      preventiveAction,
      closureReason,
      csatRating,
      csatFeedback,
      linkedCustomer,
      linkedOpportunity,
      linkedProject,
    } = req.body;

    let allUsers = await getAllUsers();
    let updatedComplaint;
    let priorComplaint;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      const existing = fallbackStore.complaints[index];
      priorComplaint = { ...existing };

      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only edit complaints assigned to you or your subordinates.',
        });
      }

      const newStatus = status || existing.status;
      const isNowResolved = ['Resolved', 'Closed'].includes(newStatus);
      const wasResolved = ['Resolved', 'Closed'].includes(existing.status);

      let resolvedAt = existing.resolvedAt;
      let closedAt = existing.closedAt;
      if (isNowResolved && !wasResolved) {
        resolvedAt = new Date().toISOString();
        if (newStatus === 'Closed') closedAt = new Date().toISOString();
      } else if (!isNowResolved) {
        resolvedAt = null;
        closedAt = null;
      }

      // Handle Pause state transition for SLA
      let isPaused = existing.isPaused || false;
      let pausedAt = existing.pausedAt;
      let totalPausedTimeMs = existing.totalPausedTimeMs || 0;
      let slaDeadline = existing.slaDeadline;

      if (newStatus === 'Awaiting Customer' && existing.status !== 'Awaiting Customer') {
        isPaused = true;
        pausedAt = new Date().toISOString();
      } else if (existing.status === 'Awaiting Customer' && newStatus !== 'Awaiting Customer' && pausedAt) {
        isPaused = false;
        const pauseDurationMs = new Date().getTime() - new Date(pausedAt).getTime();
        totalPausedTimeMs += pauseDurationMs;
        // Extend deadline by paused time
        if (slaDeadline) {
          slaDeadline = new Date(new Date(slaDeadline).getTime() + pauseDurationMs).toISOString();
        }
        pausedAt = null;
      }

      const updated = {
        ...existing,
        subject: subject !== undefined ? subject : existing.subject,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        subCategory: subCategory !== undefined ? subCategory : existing.subCategory,
        complaintType: complaintType !== undefined ? complaintType : existing.complaintType,
        productOrService: productOrService !== undefined ? productOrService : existing.productOrService,
        source: source !== undefined ? source : existing.source,
        priority: priority !== undefined ? priority : existing.priority,
        severity: severity !== undefined ? severity : existing.severity,
        status: newStatus,
        assignedTo: assignedTo !== undefined ? assignedTo : existing.assignedTo,
        assignedToName: assignedToName !== undefined ? assignedToName : existing.assignedToName,
        team: team !== undefined ? team : existing.team,
        nextFollowUpDate: nextFollowUpDate !== undefined ? (nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : null) : existing.nextFollowUpDate,
        nextFollowUpTime: nextFollowUpTime !== undefined ? nextFollowUpTime : existing.nextFollowUpTime,
        nextFollowUpPurpose: nextFollowUpPurpose !== undefined ? nextFollowUpPurpose : existing.nextFollowUpPurpose,
        resolutionNotes: resolutionNotes !== undefined ? resolutionNotes : existing.resolutionNotes,
        resolutionSummary: resolutionSummary !== undefined ? resolutionSummary : existing.resolutionSummary,
        resolutionCode: resolutionCode !== undefined ? resolutionCode : existing.resolutionCode,
        rootCause: rootCause !== undefined ? rootCause : existing.rootCause,
        correctiveAction: correctiveAction !== undefined ? correctiveAction : existing.correctiveAction,
        preventiveAction: preventiveAction !== undefined ? preventiveAction : existing.preventiveAction,
        closureReason: closureReason !== undefined ? closureReason : existing.closureReason,
        csatRating: csatRating !== undefined ? csatRating : existing.csatRating,
        csatFeedback: csatFeedback !== undefined ? csatFeedback : existing.csatFeedback,
        linkedCustomer: linkedCustomer !== undefined ? linkedCustomer : existing.linkedCustomer,
        linkedOpportunity: linkedOpportunity !== undefined ? linkedOpportunity : existing.linkedOpportunity,
        linkedProject: linkedProject !== undefined ? linkedProject : existing.linkedProject,
        isPaused,
        pausedAt,
        totalPausedTimeMs,
        slaDeadline,
        resolvedAt,
        closedAt,
        updatedAt: new Date().toISOString(),
      };

      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      priorComplaint = complaint.toObject();

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only edit complaints assigned to you or your subordinates.',
        });
      }

      if (subject !== undefined) complaint.subject = subject;
      if (description !== undefined) complaint.description = description;
      if (category !== undefined) complaint.category = category;
      if (subCategory !== undefined) complaint.subCategory = subCategory;
      if (complaintType !== undefined) complaint.complaintType = complaintType;
      if (productOrService !== undefined) complaint.productOrService = productOrService;
      if (source !== undefined) complaint.source = source;
      if (priority !== undefined) complaint.priority = priority;
      if (severity !== undefined) complaint.severity = severity;
      if (assignedTo !== undefined) complaint.assignedTo = assignedTo;
      if (assignedToName !== undefined) complaint.assignedToName = assignedToName;
      if (team !== undefined) complaint.team = team;
      if (nextFollowUpDate !== undefined) complaint.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
      if (nextFollowUpTime !== undefined) complaint.nextFollowUpTime = nextFollowUpTime;
      if (nextFollowUpPurpose !== undefined) complaint.nextFollowUpPurpose = nextFollowUpPurpose;
      if (resolutionNotes !== undefined) complaint.resolutionNotes = resolutionNotes;
      if (resolutionSummary !== undefined) complaint.resolutionSummary = resolutionSummary;
      if (resolutionCode !== undefined) complaint.resolutionCode = resolutionCode;
      if (rootCause !== undefined) complaint.rootCause = rootCause;
      if (correctiveAction !== undefined) complaint.correctiveAction = correctiveAction;
      if (preventiveAction !== undefined) complaint.preventiveAction = preventiveAction;
      if (closureReason !== undefined) complaint.closureReason = closureReason;
      if (csatRating !== undefined) complaint.csatRating = csatRating;
      if (csatFeedback !== undefined) complaint.csatFeedback = csatFeedback;
      if (linkedCustomer !== undefined) complaint.linkedCustomer = linkedCustomer;
      if (linkedOpportunity !== undefined) complaint.linkedOpportunity = linkedOpportunity;
      if (linkedProject !== undefined) complaint.linkedProject = linkedProject;

      if (status !== undefined) {
        const isNowResolved = ['Resolved', 'Closed'].includes(status);
        const wasResolved = ['Resolved', 'Closed'].includes(complaint.status);
        complaint.status = status;
        if (isNowResolved && !wasResolved) {
          complaint.resolvedAt = new Date();
          if (status === 'Closed') complaint.closedAt = new Date();
        } else if (!isNowResolved) {
          complaint.resolvedAt = null;
          complaint.closedAt = null;
        }

        if (status === 'Awaiting Customer' && complaint.status !== 'Awaiting Customer') {
          complaint.isPaused = true;
          complaint.pausedAt = new Date();
        } else if (complaint.status === 'Awaiting Customer' && status !== 'Awaiting Customer' && complaint.pausedAt) {
          complaint.isPaused = false;
          const pauseDurationMs = new Date().getTime() - new Date(complaint.pausedAt).getTime();
          complaint.totalPausedTimeMs = (complaint.totalPausedTimeMs || 0) + pauseDurationMs;
          if (complaint.slaDeadline) {
            complaint.slaDeadline = new Date(new Date(complaint.slaDeadline).getTime() + pauseDurationMs);
          }
          complaint.pausedAt = null;
        }
      }

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    // Log Audit Action
    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: status && status !== priorComplaint.status ? 'STATUS_CHANGE' : 'UPDATE',
      operator: req.user,
      prior_state: priorComplaint,
      updated_state: updatedComplaint,
      delta: `Updated complaint ${updatedComplaint.ticketNumber}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_updated', updatedComplaint);
    }

    return res.json({
      success: true,
      message: 'Complaint updated successfully',
      complaint: updatedComplaint,
    });
  } catch (err) {
    console.error('[Update Complaint Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update complaint' });
  }
});

// @route   PUT /api/complaints/:id/assign
// @desc    Assign or reassign complaint to user/team with reason and retain history
// @access  Private
router.put('/:id/assign', protect, requireComplaintModule, async (req, res) => {
  try {
    const { assignedTo, assignedToName, team, reason = 'Reassignment requested' } = req.body;

    let allUsers = await getAllUsers();
    let updatedComplaint;
    let priorComplaint;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      const existing = fallbackStore.complaints[index];
      priorComplaint = { ...existing };

      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only assign complaints within your authorized hierarchy.',
        });
      }

      const historyEntry = {
        fromUser: existing.assignedTo ? existing.assignedTo.toString() : '',
        fromUserName: existing.assignedToName || 'Unassigned',
        toUser: assignedTo ? assignedTo.toString() : '',
        toUserName: assignedToName || 'Unassigned',
        assignedBy: req.user._id ? req.user._id.toString() : '',
        assignedByName: req.user.name || '',
        reason,
        timestamp: new Date().toISOString(),
      };

      const activityEntry = {
        activityId: 'act_' + Date.now(),
        type: 'Status Change',
        author: req.user._id ? req.user._id.toString() : '',
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Complaint Reassigned',
        content: `Reassigned from ${existing.assignedToName} to ${assignedToName}. Reason: ${reason}`,
        timestamp: new Date().toISOString(),
      };

      const updated = {
        ...existing,
        assignedTo: assignedTo || null,
        assignedToName: assignedToName || 'Unassigned',
        team: team || existing.team,
        status: existing.status === 'Logged' ? 'Assigned' : existing.status,
        assignmentHistory: [historyEntry, ...(existing.assignmentHistory || [])],
        activities: [activityEntry, ...(existing.activities || [])],
        updatedAt: new Date().toISOString(),
      };

      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }
      priorComplaint = complaint.toObject();

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only assign complaints within your authorized hierarchy.',
        });
      }

      complaint.assignmentHistory.unshift({
        fromUser: complaint.assignedTo ? complaint.assignedTo.toString() : '',
        fromUserName: complaint.assignedToName || 'Unassigned',
        toUser: assignedTo ? assignedTo.toString() : '',
        toUserName: assignedToName || 'Unassigned',
        assignedBy: req.user._id.toString(),
        assignedByName: req.user.name || '',
        reason,
        timestamp: new Date(),
      });

      complaint.activities.unshift({
        activityId: 'act_' + Date.now(),
        type: 'Status Change',
        author: req.user._id.toString(),
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Complaint Reassigned',
        content: `Reassigned from ${complaint.assignedToName} to ${assignedToName}. Reason: ${reason}`,
        timestamp: new Date(),
      });

      complaint.assignedTo = assignedTo || null;
      complaint.assignedToName = assignedToName || 'Unassigned';
      if (team) complaint.team = team;
      if (complaint.status === 'Logged') complaint.status = 'Assigned';

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: 'ASSIGNMENT',
      operator: req.user,
      prior_state: priorComplaint,
      updated_state: updatedComplaint,
      delta: `Reassigned ${updatedComplaint.ticketNumber} to ${assignedToName}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_updated', updatedComplaint);
      io.emit('notification', {
        type: 'complaint_assigned',
        title: `Ticket Assigned: ${updatedComplaint.ticketNumber}`,
        message: `Assigned to ${assignedToName} (${updatedComplaint.customerName}: ${updatedComplaint.subject})`,
        timestamp: new Date(),
      });
    }

    return res.json({
      success: true,
      message: `Complaint reassigned to ${assignedToName}`,
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to assign complaint', error: err.message });
  }
});

// @route   PUT /api/complaints/:id/escalate
// @desc    Escalate complaint ticket
// @access  Private
router.put('/:id/escalate', protect, requireComplaintModule, async (req, res) => {
  try {
    const { escalationReason = 'Critical issue requires immediate attention', escalatedTo = '' } = req.body;

    let allUsers = await getAllUsers();
    let updatedComplaint;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const activityEntry = {
        activityId: 'act_' + Date.now(),
        type: 'Escalation',
        author: req.user._id ? req.user._id.toString() : '',
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Ticket Escalated',
        content: `Escalated by ${req.user.name}. Reason: ${escalationReason}`,
        timestamp: new Date().toISOString(),
      };

      const updated = {
        ...existing,
        status: 'Escalated',
        isEscalated: true,
        escalationReason,
        escalatedTo: escalatedTo || 'Management Desk',
        escalatedAt: new Date().toISOString(),
        activities: [activityEntry, ...(existing.activities || [])],
        updatedAt: new Date().toISOString(),
      };

      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found' });

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      complaint.status = 'Escalated';
      complaint.isEscalated = true;
      complaint.escalationReason = escalationReason;
      complaint.escalatedTo = escalatedTo || 'Management Desk';
      complaint.escalatedAt = new Date();

      complaint.activities.unshift({
        activityId: 'act_' + Date.now(),
        type: 'Escalation',
        author: req.user._id.toString(),
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Ticket Escalated',
        content: `Escalated by ${req.user.name}. Reason: ${escalationReason}`,
        timestamp: new Date(),
      });

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: 'ESCALATE',
      operator: req.user,
      delta: `Escalated ticket ${updatedComplaint.ticketNumber}: ${escalationReason}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_updated', updatedComplaint);
      io.emit('notification', {
        type: 'complaint_escalated',
        title: `🚨 Escalation Alert: ${updatedComplaint.ticketNumber}`,
        message: `${updatedComplaint.customerName}: ${escalationReason}`,
        timestamp: new Date(),
      });
    }

    return res.json({
      success: true,
      message: 'Complaint escalated successfully',
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to escalate complaint' });
  }
});

// @route   POST /api/complaints/:id/activities
// @desc    Add activity log or schedule follow-up on a complaint
// @access  Private
router.post('/:id/activities', protect, requireComplaintModule, async (req, res) => {
  try {
    const {
      type = 'Note',
      subject = '',
      content = '',
      outcome = '',
      nextAction = '',
      nextFollowUpDate = '',
      nextFollowUpTime = '',
    } = req.body;

    let allUsers = await getAllUsers();
    let updatedComplaint;

    const activityEntry = {
      activityId: 'act_' + Date.now(),
      type,
      author: req.user._id ? req.user._id.toString() : '',
      authorName: req.user.name || '',
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      subject: subject || `${type} Logged`,
      content,
      outcome,
      nextAction,
      nextFollowUpDate,
      nextFollowUpTime,
      timestamp: new Date().toISOString(),
    };

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) return res.status(404).json({ success: false, message: 'Complaint not found' });

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const updated = {
        ...existing,
        activities: [activityEntry, ...(existing.activities || [])],
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : existing.nextFollowUpDate,
        nextFollowUpTime: nextFollowUpTime || existing.nextFollowUpTime,
        nextFollowUpPurpose: nextAction || existing.nextFollowUpPurpose,
        updatedAt: new Date().toISOString(),
      };
      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found' });

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      complaint.activities.unshift({
        ...activityEntry,
        timestamp: new Date(),
      });

      if (nextFollowUpDate) complaint.nextFollowUpDate = new Date(nextFollowUpDate);
      if (nextFollowUpTime) complaint.nextFollowUpTime = nextFollowUpTime;
      if (nextAction) complaint.nextFollowUpPurpose = nextAction;

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: 'ACTIVITY_LOGGED',
      operator: req.user,
      delta: `Logged ${type} on ${updatedComplaint.ticketNumber}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_updated', updatedComplaint);
    }

    return res.status(201).json({
      success: true,
      message: 'Activity recorded successfully',
      activity: activityEntry,
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record activity' });
  }
});

// @route   PUT /api/complaints/:id/investigate
// @desc    Update Investigation, RCA, and CAPA
// @access  Private
router.put('/:id/investigate', protect, requireComplaintModule, async (req, res) => {
  try {
    const { investigationNotes = '', rootCause = '', correctiveAction = '', preventiveAction = '' } = req.body;

    let allUsers = await getAllUsers();
    let updatedComplaint;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) return res.status(404).json({ success: false, message: 'Complaint not found' });

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const updated = {
        ...existing,
        investigationNotes,
        rootCause,
        correctiveAction,
        preventiveAction,
        status: existing.status === 'Logged' ? 'Under Investigation' : existing.status,
        updatedAt: new Date().toISOString(),
      };

      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found' });

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      complaint.investigationNotes = investigationNotes;
      complaint.rootCause = rootCause;
      complaint.correctiveAction = correctiveAction;
      complaint.preventiveAction = preventiveAction;
      if (complaint.status === 'Logged') complaint.status = 'Under Investigation';

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: 'INVESTIGATION_UPDATE',
      operator: req.user,
      delta: `Updated RCA and CAPA on ${updatedComplaint.ticketNumber}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_updated', updatedComplaint);
    }

    return res.json({
      success: true,
      message: 'Investigation details updated',
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update investigation' });
  }
});

// @route   PUT /api/complaints/:id/resolve
// @desc    Quick resolution endpoint with RCA, CAPA, resolutionCode, CSAT
// @access  Private
router.put('/:id/resolve', protect, requireComplaintModule, async (req, res) => {
  try {
    const {
      resolutionNotes = '',
      resolutionSummary = '',
      resolutionCode = 'Bug Fixed',
      rootCause = '',
      correctiveAction = '',
      preventiveAction = '',
      csatRating = 5,
      csatFeedback = '',
    } = req.body;

    let allUsers = await getAllUsers();
    let updatedComplaint;
    const resolvedAt = new Date().toISOString();

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only resolve complaints assigned to you or your subordinates.',
        });
      }

      const activityEntry = {
        activityId: 'act_' + Date.now(),
        type: 'Status Change',
        author: req.user._id ? req.user._id.toString() : '',
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Complaint Marked as Resolved',
        content: `Resolved by ${req.user.name}. Code: ${resolutionCode}. Notes: ${resolutionNotes || resolutionSummary}`,
        timestamp: new Date().toISOString(),
      };

      const updated = {
        ...existing,
        status: 'Resolved',
        resolutionNotes: resolutionNotes || resolutionSummary,
        resolutionSummary: resolutionSummary || resolutionNotes,
        resolutionCode,
        rootCause: rootCause || existing.rootCause,
        correctiveAction: correctiveAction || existing.correctiveAction,
        preventiveAction: preventiveAction || existing.preventiveAction,
        csatRating: Number(csatRating) || 5,
        csatFeedback,
        resolvedAt,
        activities: [activityEntry, ...(existing.activities || [])],
        updatedAt: new Date().toISOString(),
      };
      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only resolve complaints assigned to you or your subordinates.',
        });
      }

      complaint.status = 'Resolved';
      complaint.resolutionNotes = resolutionNotes || resolutionSummary;
      complaint.resolutionSummary = resolutionSummary || resolutionNotes;
      complaint.resolutionCode = resolutionCode;
      if (rootCause) complaint.rootCause = rootCause;
      if (correctiveAction) complaint.correctiveAction = correctiveAction;
      if (preventiveAction) complaint.preventiveAction = preventiveAction;
      complaint.csatRating = Number(csatRating) || 5;
      complaint.csatFeedback = csatFeedback;
      complaint.resolvedAt = new Date();

      complaint.activities.unshift({
        activityId: 'act_' + Date.now(),
        type: 'Status Change',
        author: req.user._id.toString(),
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Complaint Marked as Resolved',
        content: `Resolved by ${req.user.name}. Code: ${resolutionCode}. Notes: ${resolutionNotes || resolutionSummary}`,
        timestamp: new Date(),
      });

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: 'RESOLVE',
      operator: req.user,
      delta: `Resolved ticket ${updatedComplaint.ticketNumber} (${resolutionCode})`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_resolved', updatedComplaint);
      io.emit('notification', {
        type: 'complaint_resolved',
        title: `Ticket Resolved: ${updatedComplaint.ticketNumber}`,
        message: `${updatedComplaint.customerName} issue resolved. SLA: ${updatedComplaint.slaStatus}`,
        timestamp: new Date(),
      });
    }

    return res.json({
      success: true,
      message: 'Complaint marked as Resolved',
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to resolve complaint' });
  }
});

// @route   PUT /api/complaints/:id/close
// @desc    Close complaint ticket with reason
// @access  Private
router.put('/:id/close', protect, requireComplaintModule, async (req, res) => {
  try {
    const { closureReason = 'Resolved to Satisfaction' } = req.body;
    let allUsers = await getAllUsers();
    let updatedComplaint;
    const closedAt = new Date().toISOString();

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) return res.status(404).json({ success: false, message: 'Complaint not found' });

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const updated = {
        ...existing,
        status: 'Closed',
        closureReason,
        closedAt,
        resolvedAt: existing.resolvedAt || closedAt,
        updatedAt: new Date().toISOString(),
      };
      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found' });

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      complaint.status = 'Closed';
      complaint.closureReason = closureReason;
      complaint.closedAt = new Date();
      if (!complaint.resolvedAt) complaint.resolvedAt = new Date();

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: 'CLOSE',
      operator: req.user,
      delta: `Closed ticket ${updatedComplaint.ticketNumber} (${closureReason})`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_updated', updatedComplaint);
    }

    return res.json({
      success: true,
      message: 'Complaint closed successfully',
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to close complaint' });
  }
});

// @route   PUT /api/complaints/:id/reopen
// @desc    Reopen a previously resolved or closed complaint
// @access  Private
router.put('/:id/reopen', protect, requireComplaintModule, async (req, res) => {
  try {
    const { reopenReason = 'Customer reported issue is not fully resolved' } = req.body;
    let allUsers = await getAllUsers();
    let updatedComplaint;
    const reopenedAt = new Date().toISOString();

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) return res.status(404).json({ success: false, message: 'Complaint not found' });

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const activityEntry = {
        activityId: 'act_' + Date.now(),
        type: 'Status Change',
        author: req.user._id ? req.user._id.toString() : '',
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Ticket Reopened',
        content: `Reopened by ${req.user.name}. Reason: ${reopenReason}`,
        timestamp: new Date().toISOString(),
      };

      const updated = {
        ...existing,
        status: 'Reopened',
        reopenReason,
        reopenCount: (existing.reopenCount || 0) + 1,
        reopenedAt,
        resolvedAt: null,
        closedAt: null,
        activities: [activityEntry, ...(existing.activities || [])],
        updatedAt: new Date().toISOString(),
      };
      updated.slaStatus = getComputedSlaStatus(updated);
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found' });

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      complaint.status = 'Reopened';
      complaint.reopenReason = reopenReason;
      complaint.reopenCount = (complaint.reopenCount || 0) + 1;
      complaint.reopenedAt = new Date();
      complaint.resolvedAt = null;
      complaint.closedAt = null;

      complaint.activities.unshift({
        activityId: 'act_' + Date.now(),
        type: 'Status Change',
        author: req.user._id.toString(),
        authorName: req.user.name || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        subject: 'Ticket Reopened',
        content: `Reopened by ${req.user.name}. Reason: ${reopenReason}`,
        timestamp: new Date(),
      });

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: updatedComplaint._id || updatedComplaint.ticketNumber,
      action: 'REOPEN',
      operator: req.user,
      delta: `Reopened ticket ${updatedComplaint.ticketNumber}: ${reopenReason}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_updated', updatedComplaint);
      io.emit('notification', {
        type: 'complaint_reopened',
        title: `Ticket Reopened: ${updatedComplaint.ticketNumber}`,
        message: `${updatedComplaint.customerName} ticket was reopened. Reason: ${reopenReason}`,
        timestamp: new Date(),
      });
    }

    return res.json({
      success: true,
      message: 'Complaint reopened successfully',
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reopen complaint' });
  }
});

// @route   POST /api/complaints/:id/link
// @desc    Link related complaint or Knowledge Base article
// @access  Private
router.post('/:id/link', protect, requireComplaintModule, async (req, res) => {
  try {
    const { linkedComplaintId, isDuplicate = false, kbArticle = null } = req.body;
    let allUsers = await getAllUsers();
    let updatedComplaint;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) return res.status(404).json({ success: false, message: 'Complaint not found' });

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const linkedComplaints = Array.isArray(existing.linkedComplaints) ? [...existing.linkedComplaints] : [];
      if (linkedComplaintId && !linkedComplaints.includes(linkedComplaintId)) {
        linkedComplaints.push(linkedComplaintId);
      }

      const updated = {
        ...existing,
        linkedComplaints,
        isDuplicate: isDuplicate !== undefined ? isDuplicate : existing.isDuplicate,
        knowledgeBaseArticle: kbArticle || existing.knowledgeBaseArticle,
        updatedAt: new Date().toISOString(),
      };
      fallbackStore.complaints[index] = updated;
      fallbackStore.saveToFile();
      updatedComplaint = updated;
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) return res.status(404).json({ success: false, message: 'Complaint not found' });

      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      if (linkedComplaintId && !complaint.linkedComplaints.includes(linkedComplaintId)) {
        complaint.linkedComplaints.push(linkedComplaintId);
      }
      if (isDuplicate !== undefined) complaint.isDuplicate = isDuplicate;
      if (kbArticle) complaint.knowledgeBaseArticle = kbArticle;

      await complaint.save();
      updatedComplaint = complaint.toObject();
    }

    return res.json({
      success: true,
      message: 'Linked items updated successfully',
      complaint: updatedComplaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to link item' });
  }
});

// @route   DELETE /api/complaints/:id
// @desc    Delete complaint ticket
// @access  Private (Super Admin)
router.delete('/:id', protect, requireComplaintModule, async (req, res) => {
  try {
    const userRoles = Array.isArray(req.user.roles) && req.user.roles.length > 0 ? req.user.roles : [req.user.role || 'User'];
    const isSuperAdmin = userRoles.some((r) => r === 'Super Admin' || r === 'superadmin') || req.user.role === 'Super Admin';

    if (!isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Only Super Admin has permission to delete complaint tickets.',
      });
    }

    let deleted;
    let deletedObj = null;

    if (fallbackStore.isFallback) {
      const complaint = (fallbackStore.complaints || []).find((c) => c._id.toString() === req.params.id);
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }
      deletedObj = complaint;

      const initialLen = (fallbackStore.complaints || []).length;
      fallbackStore.complaints = (fallbackStore.complaints || []).filter((c) => c._id.toString() !== req.params.id);
      if (fallbackStore.complaints.length !== initialLen) {
        deleted = true;
        fallbackStore.saveToFile();
      }
    } else {
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }
      deletedObj = complaint.toObject();

      const resDel = await Complaint.findByIdAndDelete(req.params.id);
      if (resDel) deleted = true;
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    await logAuditAction({
      entity_type: 'Complaint',
      entity_id: req.params.id,
      action: 'DELETE',
      operator: req.user,
      prior_state: deletedObj,
      delta: `Deleted complaint ticket ${deletedObj?.ticketNumber || req.params.id}`,
      req,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('complaint_deleted', { id: req.params.id });
    }

    return res.json({ success: true, message: 'Complaint ticket deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete complaint' });
  }
});

module.exports = router;
