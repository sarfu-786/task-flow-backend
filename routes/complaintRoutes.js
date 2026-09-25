const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// Helper to check if Complaint Management module is active
const isComplaintModuleActive = () => {
  const activeMods = fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects'];
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

// Helper to compute SLA deadline from priority
const computeSlaDeadline = (priority, hoursOverride) => {
  const now = new Date();
  let hours = 24; // Default Medium

  if (hoursOverride && !isNaN(Number(hoursOverride))) {
    hours = Number(hoursOverride);
  } else if (priority === 'Urgent') {
    hours = 4;
  } else if (priority === 'High') {
    hours = 12;
  } else if (priority === 'Low') {
    hours = 48;
  }

  return {
    slaHours: hours,
    slaDeadline: new Date(now.getTime() + hours * 60 * 60 * 1000),
  };
};

// Helper to recalculate SLA status dynamically
const getComputedSlaStatus = (complaint) => {
  if (['Resolved', 'Closed'].includes(complaint.status)) {
    if (complaint.resolvedAt && complaint.slaDeadline) {
      return new Date(complaint.resolvedAt) <= new Date(complaint.slaDeadline) ? 'Met' : 'Breached';
    }
    return 'Met';
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
 * Helper to get all user IDs that are subordinate to (under) the current user in hierarchy
 */
const getSubordinateUserIds = (assignerUser, allUsers) => {
  if (!assignerUser || !allUsers || !Array.isArray(allUsers)) return new Set();
  const assignerId = (assignerUser._id ? assignerUser._id.toString() : (assignerUser.id ? assignerUser.id.toString() : '')).trim();
  const assignerName = (assignerUser.name || '').toLowerCase().trim();

  const subordinateIds = new Set();
  if (!assignerId && !assignerName) return subordinateIds;

  const queue = [assignerId];
  const processed = new Set([assignerId]);

  while (queue.length > 0) {
    const currentParentId = queue.shift();
    const parentUser = allUsers.find((u) => u && u._id && u._id.toString() === currentParentId);
    const parentName = (parentUser?.name || (currentParentId === assignerId ? assignerName : '')).toLowerCase().trim();

    for (const u of allUsers) {
      if (!u || !u._id) continue;
      const uIdStr = u._id.toString();
      if (uIdStr === assignerId || processed.has(uIdStr)) continue;

      const repIdStr = u.reportsTo ? (u.reportsTo._id ? u.reportsTo._id.toString() : u.reportsTo.toString()) : '';
      const repNameStr = (u.reportsToName || '').toLowerCase().trim();
      const createdByStr = u.createdBy ? (u.createdBy._id ? u.createdBy._id.toString() : u.createdBy.toString()) : '';

      const isDirectReport =
        (currentParentId && repIdStr === currentParentId) ||
        (parentName && repNameStr && (repNameStr.includes(parentName) || parentName.includes(repNameStr)));

      const isCreatedByParent = currentParentId && createdByStr === currentParentId;

      if (isDirectReport || isCreatedByParent) {
        subordinateIds.add(uIdStr);
        processed.add(uIdStr);
        queue.push(uIdStr);
      }
    }
  }

  return subordinateIds;
};

/**
 * Checks if a user can access a complaint (Super Admin / Service Coordinator / Manager / Executive = all, User = unassigned + subordinates + self)
 */
const canUserAccessComplaint = (currentUser, complaint, allUsers) => {
  if (!currentUser || !complaint) return false;
  const userRoles = Array.isArray(currentUser.roles) && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role || 'User'];
  if (userRoles.some((r) => ['Super Admin', 'Service Coordinator', 'Manager', 'Administrator', 'Executive'].includes(r))) {
    return true;
  }

  const currentUserId = (currentUser._id ? currentUser._id.toString() : (currentUser.id ? currentUser.id.toString() : '')).trim();
  const currentUserName = (currentUser.name || '').toLowerCase().trim();
  const currentUserUsername = (currentUser.username || '').toLowerCase().trim();

  const subordinateIdsSet = getSubordinateUserIds(currentUser, allUsers);
  const subordinateUsers = (allUsers || []).filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));
  const subordinateNames = subordinateUsers.map((u) => (u.name || '').toLowerCase().trim());
  const subordinateUsernames = subordinateUsers.map((u) => (u.username || '').toLowerCase().trim());
  const subordinateIds = Array.from(subordinateIdsSet);

  const allowedIds = new Set([currentUserId, ...subordinateIds]);
  const allowedNames = new Set([currentUserName, currentUserUsername, ...subordinateNames, ...subordinateUsernames].filter(Boolean));

  // Check Assigned To - unassigned tickets are visible to staff
  const cAssignedId = complaint.assignedTo ? (complaint.assignedTo._id ? complaint.assignedTo._id.toString() : complaint.assignedTo.toString()) : '';
  const cAssignedName = (complaint.assignedToName || '').toLowerCase().trim();
  if (!cAssignedId || cAssignedName === 'unassigned' || allowedIds.has(cAssignedId) || allowedNames.has(cAssignedName)) {
    return true;
  }

  // Check Created By
  const cCreatedById = complaint.createdBy ? (complaint.createdBy._id ? complaint.createdBy._id.toString() : complaint.createdBy.toString()) : '';
  const cCreatedByName = (complaint.createdByName || '').toLowerCase().trim();
  if (cCreatedById && allowedIds.has(cCreatedById)) return true;
  if (cCreatedByName && allowedNames.has(cCreatedByName)) return true;

  return false;
};

// @route   GET /api/complaints
// @desc    Get all complaints with multi-filter, search, pagination, and SLA stats
// @access  Private
router.get('/', protect, requireComplaintModule, async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      category = 'all',
      priority = 'all',
      slaStatus = 'all',
      assignedTo = 'all',
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageLimit = Math.max(1, parseInt(limit, 10));

    let complaintsList = [];
    let allUsers = [];

    if (fallbackStore.isFallback) {
      complaintsList = [...(fallbackStore.complaints || [])];
      allUsers = fallbackStore.users || [];
    } else {
      const dbComplaints = await Complaint.find({}).sort({ createdAt: -1 });
      complaintsList = dbComplaints.map((c) => c.toObject());
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    // Refresh dynamic SLA status
    complaintsList = complaintsList.map((c) => ({
      ...c,
      slaStatus: getComputedSlaStatus(c),
    }));

    // User permissions & scoping: Super Admin, Service Coordinators, Managers get all
    const user = req.user;
    const userRoles = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role || 'User'];
    const hasOrgAccess = userRoles.some((r) => ['Super Admin', 'Service Coordinator', 'Manager', 'Administrator', 'Executive'].includes(r));

    if (!hasOrgAccess) {
      complaintsList = complaintsList.filter((c) => canUserAccessComplaint(user, c, allUsers));
    }

    // Global Stats before filters
    const stats = {
      total: complaintsList.length,
      logged: complaintsList.filter((c) => c.status === 'Logged').length,
      inProgress: complaintsList.filter((c) => ['Under Investigation', 'In Progress', 'Awaiting Customer'].includes(c.status)).length,
      resolved: complaintsList.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length,
      slaBreached: complaintsList.filter((c) => c.slaStatus === 'Breached').length,
      slaAtRisk: complaintsList.filter((c) => c.slaStatus === 'At Risk').length,
      slaMet: complaintsList.filter((c) => c.slaStatus === 'Met').length,
      urgent: complaintsList.filter((c) => c.priority === 'Urgent' && !['Resolved', 'Closed'].includes(c.status)).length,
    };

    // Apply Filters
    let filtered = complaintsList;

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(
        (c) =>
          (c.ticketNumber && c.ticketNumber.toLowerCase().includes(q)) ||
          (c.customerName && c.customerName.toLowerCase().includes(q)) ||
          (c.subject && c.subject.toLowerCase().includes(q)) ||
          (c.description && c.description.toLowerCase().includes(q)) ||
          (c.organization && c.organization.toLowerCase().includes(q)) ||
          (c.assignedToName && c.assignedToName.toLowerCase().includes(q))
      );
    }

    if (status && status !== 'all') {
      filtered = filtered.filter((c) => c.status === status);
    }

    if (category && category !== 'all') {
      filtered = filtered.filter((c) => c.category === category);
    }

    if (priority && priority !== 'all') {
      filtered = filtered.filter((c) => c.priority === priority);
    }

    if (slaStatus && slaStatus !== 'all') {
      filtered = filtered.filter((c) => c.slaStatus === slaStatus);
    }

    if (assignedTo && assignedTo !== 'all') {
      filtered = filtered.filter(
        (c) =>
          c.assignedToName &&
          c.assignedToName.toLowerCase().includes(assignedTo.toLowerCase().trim())
      );
    }

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
// @desc    Get single complaint
// @access  Private
router.get('/:id', protect, requireComplaintModule, async (req, res) => {
  try {
    let complaint;
    let allUsers = [];
    if (fallbackStore.isFallback) {
      complaint = (fallbackStore.complaints || []).find((c) => c._id.toString() === req.params.id);
      allUsers = fallbackStore.users || [];
    } else {
      complaint = await Complaint.findById(req.params.id);
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const complaintObj = typeof complaint.toObject === 'function' ? complaint.toObject() : complaint;
    complaintObj.slaStatus = getComputedSlaStatus(complaintObj);

    if (!canUserAccessComplaint(req.user, complaintObj, allUsers)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this complaint ticket' });
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
      subject,
      title,
      description,
      category = 'Other',
      priority = 'Medium',
      slaHours,
      assignedTo = null,
      assignedToName = 'Unassigned',
    } = req.body;

    const complaintSubject = (subject || title || '').trim();

    if (!customerName || !complaintSubject || !description) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, subject, and description are required.',
      });
    }

    const { slaHours: finalSlaHours, slaDeadline } = computeSlaDeadline(priority, slaHours);

    let newComplaint;
    if (fallbackStore.isFallback) {
      const ticketNumber = generateTicketNumber(fallbackStore.complaints || []);
      newComplaint = {
        _id: 'cmp_' + Date.now(),
        ticketNumber,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        organization: organization.trim(),
        subject: complaintSubject,
        description: description.trim(),
        category,
        priority,
        status: 'Logged',
        slaHours: finalSlaHours,
        slaDeadline: slaDeadline.toISOString(),
        slaStatus: 'On Track',
        assignedTo: assignedTo || null,
        assignedToName: assignedToName || 'Unassigned',
        createdBy: req.user._id ? req.user._id.toString() : null,
        createdByName: req.user.name || '',
        resolutionNotes: '',
        rootCause: '',
        csatRating: null,
        resolvedAt: null,
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
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        organization: organization.trim(),
        subject: complaintSubject,
        description: description.trim(),
        category,
        priority,
        status: 'Logged',
        slaHours: finalSlaHours,
        slaDeadline,
        assignedTo: assignedTo || null,
        assignedToName: assignedToName || 'Unassigned',
        createdBy: req.user._id,
        createdByName: req.user.name || '',
      });
      newComplaint = newComplaint.toObject();
    }

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
      priority,
      status,
      assignedTo,
      assignedToName,
      resolutionNotes,
      rootCause,
      csatRating,
    } = req.body;

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    let updatedComplaint;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to edit this complaint ticket' });
      }

      const newStatus = status || existing.status;
      const isNowResolved = ['Resolved', 'Closed'].includes(newStatus);
      const wasResolved = ['Resolved', 'Closed'].includes(existing.status);

      let resolvedAt = existing.resolvedAt;
      if (isNowResolved && !wasResolved) {
        resolvedAt = new Date().toISOString();
      } else if (!isNowResolved) {
        resolvedAt = null;
      }

      const updated = {
        ...existing,
        subject: subject !== undefined ? subject : existing.subject,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        priority: priority !== undefined ? priority : existing.priority,
        status: newStatus,
        assignedTo: assignedTo !== undefined ? assignedTo : existing.assignedTo,
        assignedToName: assignedToName !== undefined ? assignedToName : existing.assignedToName,
        resolutionNotes: resolutionNotes !== undefined ? resolutionNotes : existing.resolutionNotes,
        rootCause: rootCause !== undefined ? rootCause : existing.rootCause,
        csatRating: csatRating !== undefined ? csatRating : existing.csatRating,
        resolvedAt,
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
        return res.status(403).json({ success: false, message: 'You do not have permission to edit this complaint ticket' });
      }

      if (subject !== undefined) complaint.subject = subject;
      if (description !== undefined) complaint.description = description;
      if (category !== undefined) complaint.category = category;
      if (priority !== undefined) complaint.priority = priority;
      if (assignedTo !== undefined) complaint.assignedTo = assignedTo;
      if (assignedToName !== undefined) complaint.assignedToName = assignedToName;
      if (resolutionNotes !== undefined) complaint.resolutionNotes = resolutionNotes;
      if (rootCause !== undefined) complaint.rootCause = rootCause;
      if (csatRating !== undefined) complaint.csatRating = csatRating;

      if (status !== undefined) {
        const isNowResolved = ['Resolved', 'Closed'].includes(status);
        const wasResolved = ['Resolved', 'Closed'].includes(complaint.status);
        complaint.status = status;
        if (isNowResolved && !wasResolved) {
          complaint.resolvedAt = new Date();
        } else if (!isNowResolved) {
          complaint.resolvedAt = null;
        }
      }

      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

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

// @route   PUT /api/complaints/:id/resolve
// @desc    Quick resolution endpoint with RCA and CSAT
// @access  Private
router.put('/:id/resolve', protect, requireComplaintModule, async (req, res) => {
  try {
    const { resolutionNotes = '', rootCause = '', csatRating = 5 } = req.body;

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    let updatedComplaint;
    const resolvedAt = new Date().toISOString();

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.complaints || []).findIndex((c) => c._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }

      const existing = fallbackStore.complaints[index];
      if (!canUserAccessComplaint(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to resolve this complaint ticket' });
      }

      const updated = {
        ...existing,
        status: 'Resolved',
        resolutionNotes,
        rootCause,
        csatRating: Number(csatRating) || 5,
        resolvedAt,
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
        return res.status(403).json({ success: false, message: 'You do not have permission to resolve this complaint ticket' });
      }

      complaint.status = 'Resolved';
      complaint.resolutionNotes = resolutionNotes;
      complaint.rootCause = rootCause;
      complaint.csatRating = Number(csatRating) || 5;
      complaint.resolvedAt = new Date();
      await complaint.save();
      updatedComplaint = complaint.toObject();
      updatedComplaint.slaStatus = getComputedSlaStatus(updatedComplaint);
    }

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

// @route   DELETE /api/complaints/:id
// @desc    Delete complaint ticket
// @access  Private (Super Admin / Manager / Creator)
router.delete('/:id', protect, requireComplaintModule, async (req, res) => {
  try {
    let deleted;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      const complaint = (fallbackStore.complaints || []).find((c) => c._id.toString() === req.params.id);
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }
      if (!canUserAccessComplaint(req.user, complaint, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to delete this complaint ticket' });
      }

      const initialLen = (fallbackStore.complaints || []).length;
      fallbackStore.complaints = (fallbackStore.complaints || []).filter((c) => c._id.toString() !== req.params.id);
      if (fallbackStore.complaints.length !== initialLen) {
        deleted = true;
        fallbackStore.saveToFile();
      }
    } else {
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found' });
      }
      if (!canUserAccessComplaint(req.user, complaint.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to delete this complaint ticket' });
      }

      const resDel = await Complaint.findByIdAndDelete(req.params.id);
      if (resDel) deleted = true;
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

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
