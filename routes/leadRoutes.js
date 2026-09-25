const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Opportunity = require('../models/Opportunity');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

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

const VALID_STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Converted', 'Lost'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

// Safe regex character escaper
const escapeRegex = (str) => (str ? str.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '');

/**
 * Helper to get all user IDs that are subordinate to (under) the assigner in hierarchy
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
    allUsers = fallbackStore.users;
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
const canUserAccessLead = (currentUser, lead, allUsers) => {
  if (!currentUser || !lead) return false;
  if (currentUser.role === 'Super Admin') return true;

  const currentUserId = (currentUser._id ? currentUser._id.toString() : (currentUser.id ? currentUser.id.toString() : '')).trim();
  const currentUserName = (currentUser.name || '').toLowerCase().trim();
  const currentUserUsername = (currentUser.username || '').toLowerCase().trim();

  const subordinateIdsSet = getSubordinateUserIds(currentUser, allUsers);
  const subordinateUsers = (allUsers || []).filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));
  const subordinateNames = subordinateUsers.map((u) => (u.name || '').toLowerCase().trim());
  const subordinateUsernames = subordinateUsers.map((u) => (u.username || '').toLowerCase().trim());
  const subordinateIds = Array.from(subordinateIdsSet);

  const lAssigned = (lead.assignedTo || '').toLowerCase().trim();
  const lUser = lead.user ? lead.user.toString() : '';
  const lAssignedBy = (lead.assignedBy || '').toLowerCase().trim();
  const lAssignedById = lead.assignedById ? lead.assignedById.toString() : '';

  const isAssignedToMe = (currentUserName && lAssigned === currentUserName) || (currentUserUsername && lAssigned === currentUserUsername) || (currentUserId && lUser === currentUserId);
  const isAssignedToMySubordinate = subordinateNames.includes(lAssigned) || subordinateUsernames.includes(lAssigned) || (lUser && subordinateIds.includes(lUser));
  const isAssignedByMe = (currentUserName && lAssignedBy.includes(currentUserName)) || (currentUserUsername && lAssignedBy.includes(currentUserUsername)) || (currentUserId && lAssignedById === currentUserId);
  const isAssignedByMySubordinate = subordinateNames.some(n => lAssignedBy.includes(n)) || (lAssignedById && subordinateIds.includes(lAssignedById));

  return isAssignedToMe || isAssignedToMySubordinate || isAssignedByMe || isAssignedByMySubordinate;
};

// @route   GET /api/leads
// @desc    Get all leads with role-based filtering, search, status, priority, and assignedTo filters
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { search, status, priority, source, assignedTo } = req.query;
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';

    if (fallbackStore.isFallback) {
      let filtered = [...(fallbackStore.leads || [])];
      const allUsers = fallbackStore.users || [];

      // Hierarchy filter: Super Admin gets all; Manager & User get self + subordinates
      if (!isSuperAdmin) {
        filtered = filtered.filter((lead) => canUserAccessLead(req.user, lead, allUsers));
      }

      if (assignedTo && assignedTo !== 'all') {
        filtered = filtered.filter((l) => l.assignedTo && l.assignedTo.toLowerCase() === assignedTo.toLowerCase());
      }

      // Search filter
      if (search && search.trim() !== '') {
        const query = search.trim().toLowerCase();
        filtered = filtered.filter(
          (l) =>
            (l.name && l.name.toLowerCase().includes(query)) ||
            (l.company && l.company.toLowerCase().includes(query)) ||
            (l.email && l.email.toLowerCase().includes(query)) ||
            (l.phone && l.phone.toLowerCase().includes(query)) ||
            (l.notes && l.notes.toLowerCase().includes(query)) ||
            (l.source && l.source.toLowerCase().includes(query)) ||
            (l.assignedTo && l.assignedTo.toLowerCase().includes(query))
        );
      }

      // Status filter
      if (status && status !== 'all') {
        filtered = filtered.filter((l) => l.status === status);
      }

      // Priority filter
      if (priority && priority !== 'all') {
        filtered = filtered.filter((l) => l.priority === priority);
      }

      // Source filter
      if (source && source !== 'all') {
        filtered = filtered.filter((l) => l.source && l.source.toLowerCase() === source.toLowerCase());
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
        queryObj.$or = [
          { assignedTo: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
          { user: { $in: [req.user._id, ...subordinateIds] } },
          { assignedBy: new RegExp(escapeRegex(userName), 'i') },
        ];
      }

      if (assignedTo && assignedTo !== 'all') {
        queryObj.assignedTo = new RegExp('^' + escapeRegex(assignedTo.trim()) + '$', 'i');
      }

      if (search && search.trim() !== '') {
        const regex = new RegExp(escapeRegex(search.trim()), 'i');
        const searchConditions = [
          { name: regex },
          { company: regex },
          { email: regex },
          { phone: regex },
          { notes: regex },
          { source: regex },
          { assignedTo: regex },
        ];

        if (queryObj.$or) {
          queryObj.$and = [{ $or: queryObj.$or }, { $or: searchConditions }];
          delete queryObj.$or;
        } else {
          queryObj.$or = searchConditions;
        }
      }

      if (status && status !== 'all') {
        queryObj.status = status;
      }

      if (priority && priority !== 'all') {
        queryObj.priority = priority;
      }

      if (source && source !== 'all') {
        queryObj.source = new RegExp('^' + escapeRegex(source.trim()) + '$', 'i');
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
// @desc    Get role-scoped metrics for leads
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
            { user: { $in: [req.user._id, ...subordinateIds] } },
            { assignedBy: new RegExp(escapeRegex(userName), 'i') },
          ],
        });
      }
    }

    const total = userLeads.length;
    const newLeads = userLeads.filter((l) => l.status === 'New').length;
    const contacted = userLeads.filter((l) => l.status === 'Contacted').length;
    const qualified = userLeads.filter((l) => l.status === 'Qualified').length;
    const converted = userLeads.filter((l) => l.status === 'Converted').length;
    const lost = userLeads.filter((l) => l.status === 'Lost').length;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    res.json({
      success: true,
      stats: {
        total,
        newLeads,
        contacted,
        qualified,
        converted,
        lost,
        conversionRate,
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
// @desc    Get single lead by ID with permission check
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    let lead = null;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      lead = (fallbackStore.leads || []).find((l) => l._id.toString() === id.toString());
    } else {
      allUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      lead = await Lead.findById(id);
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
// @desc    Create a new lead (Super Admin: assign to anyone, Manager/User: assign to self or junior subordinates)
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const {
      name,
      company,
      phone,
      email,
      source = 'Website',
      status = 'New',
      priority = 'Medium',
      assignedTo,
      notes = '',
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Lead name is required' });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}`,
      });
    }

    const targetAssignedTo = (assignedTo && assignedTo.trim()) || req.user?.name || 'Current User';

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

    const newLeadData = {
      name: name.trim(),
      company: (company || '').trim(),
      phone: (phone || '').trim(),
      email: (email || '').trim().toLowerCase(),
      source: (source || 'Website').trim(),
      status: status || 'New',
      priority: priority || 'Medium',
      assignedTo: targetAssignedTo,
      assignedBy,
      assignedById: assignerIdStr,
      user: targetUserId,
      notes: (notes || '').trim(),
      convertedOpportunityId: null,
      convertedAt: null,
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

      if (io) {
        io.emit('leads:updated', { lead: createdLead, action: 'created' });
      }

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

      if (io) {
        io.emit('leads:updated', { lead, action: 'created' });
      }

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
// @desc    Edit and update full lead details with role authorization
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      company,
      phone,
      email,
      source,
      status,
      priority,
      assignedTo,
      notes,
    } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ success: false, message: 'Lead name cannot be empty' });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}`,
      });
    }

    let targetUserId = undefined;
    if (assignedTo && assignedTo.trim()) {
      const hierarchyCheck = await validateHierarchyAssignment(req.user, assignedTo.trim());
      if (!hierarchyCheck.valid) {
        return res.status(400).json({
          success: false,
          message: hierarchyCheck.message,
        });
      }
      if (hierarchyCheck.targetUser) targetUserId = hierarchyCheck.targetUser._id;
    }

    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const leadIndex = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString());
      if (leadIndex === -1) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }

      const existing = fallbackStore.leads[leadIndex];

      // Authorization check
      if (!canUserAccessLead(req.user, existing, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to modify this lead',
        });
      }

      const updated = {
        ...existing,
        name: name !== undefined ? name.trim() : existing.name,
        company: company !== undefined ? company.trim() : existing.company,
        phone: phone !== undefined ? phone.trim() : existing.phone,
        email: email !== undefined ? email.trim().toLowerCase() : existing.email,
        source: source !== undefined ? source.trim() : existing.source,
        status: status || existing.status,
        priority: priority || existing.priority,
        assignedTo: assignedTo !== undefined ? assignedTo.trim() : existing.assignedTo,
        user: targetUserId !== undefined ? targetUserId : existing.user,
        notes: notes !== undefined ? notes.trim() : existing.notes,
        updatedAt: new Date(),
      };

      fallbackStore.leads[leadIndex] = updated;
      fallbackStore.saveToFile();

      if (io) {
        io.emit('leads:updated', { lead: updated, action: 'updated' });
      }

      return res.json({
        success: true,
        message: 'Lead updated successfully',
        lead: updated,
      });
    } else {
      let lead = await Lead.findById(id);
      if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, lead, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to modify this lead',
        });
      }

      if (name !== undefined) lead.name = name.trim();
      if (company !== undefined) lead.company = company.trim();
      if (phone !== undefined) lead.phone = phone.trim();
      if (email !== undefined) lead.email = email.trim().toLowerCase();
      if (source !== undefined) lead.source = source.trim();
      if (status) lead.status = status;
      if (priority) lead.priority = priority;
      if (assignedTo !== undefined) {
        lead.assignedTo = assignedTo.trim();
        if (targetUserId) lead.user = targetUserId;
      }
      if (notes !== undefined) lead.notes = notes.trim();
      lead.updatedAt = new Date();

      await lead.save();

      try {
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = lead.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local lead backup update notice:', err.message);
      }

      if (io) {
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
// @desc    Quick update status of a lead with permission check
// @access  Private
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const leadIndex = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString());
      if (leadIndex === -1) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }

      const existing = fallbackStore.leads[leadIndex];

      if (!canUserAccessLead(req.user, existing, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to update this lead status',
        });
      }

      existing.status = status;
      existing.updatedAt = new Date();
      fallbackStore.saveToFile();

      if (io) {
        io.emit('leads:updated', { lead: existing, action: 'status' });
      }

      return res.json({
        success: true,
        message: `Lead status updated to ${status}`,
        lead: existing,
      });
    } else {
      const lead = await Lead.findById(id);
      if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, lead, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to update this lead status',
        });
      }

      lead.status = status;
      lead.updatedAt = new Date();
      await lead.save();

      try {
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = lead.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local lead status update notice:', err.message);
      }

      if (io) {
        io.emit('leads:updated', { lead, action: 'status' });
      }

      return res.json({
        success: true,
        message: `Lead status updated to ${status}`,
        lead,
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

// @route   POST /api/leads/:id/convert
// @desc    Convert a Lead to an Opportunity with authorization & assignment hierarchy check
// @access  Private
router.post('/:id/convert', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      opportunityName,
      amount = 0,
      stage = 'Qualification',
      probability = 20,
      expectedCloseDate,
      priority,
      assignedTo,
      notes,
    } = req.body;

    const io = req.app.get('io');
    let targetLead = null;

    if (fallbackStore.isFallback) {
      const leadIndex = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString());
      if (leadIndex === -1) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      targetLead = fallbackStore.leads[leadIndex];

      if (!canUserAccessLead(req.user, targetLead, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to convert this lead',
        });
      }

      const oppAssignedTo = (assignedTo && assignedTo.trim()) || targetLead.assignedTo || req.user?.name || 'Current User';
      const hierarchyCheck = await validateHierarchyAssignment(req.user, oppAssignedTo);
      if (!hierarchyCheck.valid) {
        return res.status(400).json({
          success: false,
          message: hierarchyCheck.message,
        });
      }

      let oppTargetUserId = hierarchyCheck.targetUser?._id || targetLead.user || null;
      const assignerIdStr = req.user?._id ? (req.user._id.toString ? req.user._id.toString() : req.user._id) : undefined;

      const generatedOppId = '64e8e1' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      const oppData = {
        _id: generatedOppId,
        name: (opportunityName && opportunityName.trim()) || `${targetLead.name} - Deal`,
        company: targetLead.company || '',
        relatedLead: targetLead._id,
        relatedLeadName: targetLead.name || '',
        amount: Number(amount) || 0,
        stage: stage || 'Qualification',
        probability: probability !== undefined ? Number(probability) : 20,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        priority: priority || targetLead.priority || 'Medium',
        assignedTo: oppAssignedTo,
        assignedBy: `${req.user?.name || 'User'} (${req.user?.role || 'User'})`,
        assignedById: assignerIdStr,
        user: oppTargetUserId,
        notes: notes !== undefined ? notes.trim() : targetLead.notes || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!fallbackStore.opportunities) fallbackStore.opportunities = [];
      fallbackStore.opportunities.unshift(oppData);

      // Update lead to Converted
      targetLead.status = 'Converted';
      targetLead.convertedOpportunityId = generatedOppId;
      targetLead.convertedAt = new Date();
      targetLead.updatedAt = new Date();

      fallbackStore.saveToFile();

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'converted' });
        io.emit('opportunities:updated', { opportunity: oppData, action: 'created' });
      }

      return res.status(201).json({
        success: true,
        message: 'Lead converted to opportunity successfully',
        lead: targetLead,
        opportunity: oppData,
      });
    } else {
      targetLead = await Lead.findById(id);
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

      const oppAssignedTo = (assignedTo && assignedTo.trim()) || targetLead.assignedTo || req.user?.name || 'Current User';
      const hierarchyCheck = await validateHierarchyAssignment(req.user, oppAssignedTo);
      if (!hierarchyCheck.valid) {
        return res.status(400).json({
          success: false,
          message: hierarchyCheck.message,
        });
      }

      let oppTargetUserId = hierarchyCheck.targetUser?._id || targetLead.user || null;
      const assignerIdStr = req.user?._id ? (req.user._id.toString ? req.user._id.toString() : req.user._id) : undefined;

      const oppData = {
        name: (opportunityName && opportunityName.trim()) || `${targetLead.name} - Deal`,
        company: targetLead.company || '',
        relatedLead: targetLead._id,
        relatedLeadName: targetLead.name || '',
        amount: Number(amount) || 0,
        stage: stage || 'Qualification',
        probability: probability !== undefined ? Number(probability) : 20,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        priority: priority || targetLead.priority || 'Medium',
        assignedTo: oppAssignedTo,
        assignedBy: `${req.user?.name || 'User'} (${req.user?.role || 'User'})`,
        assignedById: assignerIdStr,
        user: oppTargetUserId,
        notes: notes !== undefined ? notes.trim() : targetLead.notes || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const opportunity = await Opportunity.create(oppData);

      targetLead.status = 'Converted';
      targetLead.convertedOpportunityId = opportunity._id;
      targetLead.convertedAt = new Date();
      targetLead.updatedAt = new Date();
      await targetLead.save();

      // Mirror to fallbackStore
      try {
        if (!fallbackStore.opportunities) fallbackStore.opportunities = [];
        fallbackStore.opportunities.unshift(opportunity.toObject());
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads[localIdx] = targetLead.toObject();
        }
        fallbackStore.saveToFile();
      } catch (err) {
        console.warn('Local lead conversion backup notice:', err.message);
      }

      if (io) {
        io.emit('leads:updated', { lead: targetLead, action: 'converted' });
        io.emit('opportunities:updated', { opportunity, action: 'created' });
      }

      return res.status(201).json({
        success: true,
        message: 'Lead converted to opportunity successfully',
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
// @desc    Delete a lead with authorization check
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const leadIndex = (fallbackStore.leads || []).findIndex((l) => l._id.toString() === id.toString());
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

      if (io) {
        io.emit('leads:updated', { id, action: 'deleted' });
      }

      return res.json({
        success: true,
        message: 'Lead deleted successfully',
        lead: deleted,
      });
    } else {
      const lead = await Lead.findById(id);
      if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessLead(req.user, lead, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to delete this lead',
        });
      }

      await Lead.findByIdAndDelete(id);

      try {
        const localIdx = (fallbackStore.leads || []).findIndex(l => l._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.leads.splice(localIdx, 1);
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local lead delete notice:', err.message);
      }

      if (io) {
        io.emit('leads:updated', { id, action: 'deleted' });
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

module.exports = router;

