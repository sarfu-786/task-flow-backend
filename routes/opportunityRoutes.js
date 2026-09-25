const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Opportunity = require('../models/Opportunity');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

const VALID_STAGES = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High'];

const DEFAULT_PROBABILITIES = {
  Qualification: 20,
  Proposal: 50,
  Negotiation: 80,
  Won: 100,
  Lost: 0,
};

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
 * Validates organizational hierarchy assignment rules for Opportunities
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

  if (assignerId && targetId && assignerId === targetId) {
    return { valid: true, targetUser };
  }

  if (isSuperAdmin) {
    return { valid: true, targetUser };
  }

  if (targetRole === 'Super Admin') {
    return {
      valid: false,
      message: `${isManager ? 'Managers' : 'Users'} cannot assign opportunities to Super Admin. Opportunities can only be assigned to yourself or your junior subordinates.`,
      targetUser,
    };
  }

  if (!isManager && !isSuperAdmin && (targetRole === 'Manager' || targetRole === 'Executive' || targetRole === 'Administrator')) {
    return {
      valid: false,
      message: `Users cannot assign opportunities to managers. Opportunities can only be assigned to yourself or your junior subordinates.`,
      targetUser,
    };
  }

  const subordinateIds = getSubordinateUserIds(assignerUser, allUsers);
  const isJuniorInHierarchy = subordinateIds.has(targetId);

  if (!isJuniorInHierarchy) {
    return {
      valid: false,
      message: `Hierarchy Constraint: You can only assign opportunities to yourself or users who are under you in your team hierarchy. ('${targetUser.name}' is not in your subordinate hierarchy)`,
      targetUser,
    };
  }

  return { valid: true, targetUser };
};

/**
 * Checks if a user has permission to access (view, edit, delete, stage update) a specific opportunity
 */
const canUserAccessOpportunity = (currentUser, opp, allUsers) => {
  if (!currentUser || !opp) return false;
  if (currentUser.role === 'Super Admin') return true;

  const currentUserId = (currentUser._id ? currentUser._id.toString() : (currentUser.id ? currentUser.id.toString() : '')).trim();
  const currentUserName = (currentUser.name || '').toLowerCase().trim();
  const currentUserUsername = (currentUser.username || '').toLowerCase().trim();

  const subordinateIdsSet = getSubordinateUserIds(currentUser, allUsers);
  const subordinateUsers = (allUsers || []).filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));
  const subordinateNames = subordinateUsers.map((u) => (u.name || '').toLowerCase().trim());
  const subordinateUsernames = subordinateUsers.map((u) => (u.username || '').toLowerCase().trim());
  const subordinateIds = Array.from(subordinateIdsSet);

  const oAssigned = (opp.assignedTo || '').toLowerCase().trim();
  const oUser = opp.user ? opp.user.toString() : '';
  const oAssignedBy = (opp.assignedBy || '').toLowerCase().trim();
  const oAssignedById = opp.assignedById ? opp.assignedById.toString() : '';

  const isAssignedToMe = (currentUserName && oAssigned === currentUserName) || (currentUserUsername && oAssigned === currentUserUsername) || (currentUserId && oUser === currentUserId);
  const isAssignedToMySubordinate = subordinateNames.includes(oAssigned) || subordinateUsernames.includes(oAssigned) || (oUser && subordinateIds.includes(oUser));
  const isAssignedByMe = (currentUserName && oAssignedBy.includes(currentUserName)) || (currentUserUsername && oAssignedBy.includes(currentUserUsername)) || (currentUserId && oAssignedById === currentUserId);
  const isAssignedByMySubordinate = subordinateNames.some(n => oAssignedBy.includes(n)) || (oAssignedById && subordinateIds.includes(oAssignedById));

  return isAssignedToMe || isAssignedToMySubordinate || isAssignedByMe || isAssignedByMySubordinate;
};

// @route   GET /api/opportunities
// @desc    Get all opportunities with role-based filtering, search, stage, priority, and assignedTo filters
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { search, stage, priority, assignedTo } = req.query;
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';

    if (fallbackStore.isFallback) {
      let filtered = [...(fallbackStore.opportunities || [])];
      const allUsers = fallbackStore.users || [];

      // Hierarchy filter: Super Admin gets all; Manager & User get self + subordinates
      if (!isSuperAdmin) {
        filtered = filtered.filter((opp) => canUserAccessOpportunity(req.user, opp, allUsers));
      }

      if (assignedTo && assignedTo !== 'all') {
        filtered = filtered.filter((o) => o.assignedTo && o.assignedTo.toLowerCase() === assignedTo.toLowerCase());
      }

      if (search && search.trim() !== '') {
        const query = search.trim().toLowerCase();
        filtered = filtered.filter(
          (o) =>
            (o.name && o.name.toLowerCase().includes(query)) ||
            (o.company && o.company.toLowerCase().includes(query)) ||
            (o.relatedLeadName && o.relatedLeadName.toLowerCase().includes(query)) ||
            (o.notes && o.notes.toLowerCase().includes(query)) ||
            (o.assignedTo && o.assignedTo.toLowerCase().includes(query))
        );
      }

      if (stage && stage !== 'all') {
        filtered = filtered.filter((o) => o.stage === stage);
      }

      if (priority && priority !== 'all') {
        filtered = filtered.filter((o) => o.priority === priority);
      }

      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.json({
        success: true,
        count: filtered.length,
        roleScope: isSuperAdmin ? 'Full Organization Access' : (req.user?.role || 'User') === 'Manager' ? 'Manager & Subordinates Access' : 'Personal & Subordinates Access',
        opportunities: filtered,
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
          { relatedLeadName: regex },
          { notes: regex },
          { assignedTo: regex },
        ];

        if (queryObj.$or) {
          queryObj.$and = [{ $or: queryObj.$or }, { $or: searchConditions }];
          delete queryObj.$or;
        } else {
          queryObj.$or = searchConditions;
        }
      }

      if (stage && stage !== 'all') {
        queryObj.stage = stage;
      }

      if (priority && priority !== 'all') {
        queryObj.priority = priority;
      }

      const opportunities = await Opportunity.find(queryObj).sort({ createdAt: -1 });

      return res.json({
        success: true,
        count: opportunities.length,
        roleScope: isSuperAdmin ? 'Full Organization Access' : (req.user?.role || 'User') === 'Manager' ? 'Manager & Subordinates Access' : 'Personal & Subordinates Access',
        opportunities,
      });
    }
  } catch (error) {
    console.error('Fetch opportunities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch opportunities',
      error: error.message,
    });
  }
});

// @route   GET /api/opportunities/stats
// @desc    Get role-scoped metrics for opportunity pipeline
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';
    let userOpps = [];

    if (fallbackStore.isFallback) {
      const allOpps = fallbackStore.opportunities || [];
      const allUsers = fallbackStore.users || [];
      if (isSuperAdmin) {
        userOpps = allOpps;
      } else {
        userOpps = allOpps.filter((o) => canUserAccessOpportunity(req.user, o, allUsers));
      }
    } else {
      if (isSuperAdmin) {
        userOpps = await Opportunity.find({});
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
        userOpps = await Opportunity.find({
          $or: [
            { assignedTo: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
            { user: { $in: [req.user._id, ...subordinateIds] } },
            { assignedBy: new RegExp(escapeRegex(userName), 'i') },
          ],
        });
      }
    }

    const totalDeals = userOpps.length;
    const totalPipelineValue = userOpps.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const wonDeals = userOpps.filter((o) => o.stage === 'Won');
    const wonValue = wonDeals.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const lostDeals = userOpps.filter((o) => o.stage === 'Lost');
    const closedDealsCount = wonDeals.length + lostDeals.length;
    const winRate = closedDealsCount > 0 ? Math.round((wonDeals.length / closedDealsCount) * 100) : (totalDeals > 0 ? Math.round((wonDeals.length / totalDeals) * 100) : 0);

    const stageBreakdown = {
      Qualification: {
        count: userOpps.filter((o) => o.stage === 'Qualification').length,
        value: userOpps.filter((o) => o.stage === 'Qualification').reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
      },
      Proposal: {
        count: userOpps.filter((o) => o.stage === 'Proposal').length,
        value: userOpps.filter((o) => o.stage === 'Proposal').reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
      },
      Negotiation: {
        count: userOpps.filter((o) => o.stage === 'Negotiation').length,
        value: userOpps.filter((o) => o.stage === 'Negotiation').reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
      },
      Won: {
        count: wonDeals.length,
        value: wonValue,
      },
      Lost: {
        count: lostDeals.length,
        value: lostDeals.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
      },
    };

    res.json({
      success: true,
      stats: {
        totalDeals,
        totalPipelineValue,
        wonValue,
        winRate,
        stageBreakdown,
      },
    });
  } catch (error) {
    console.error('Opportunity stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve opportunity statistics',
      error: error.message,
    });
  }
});

// @route   GET /api/opportunities/:id
// @desc    Get single opportunity by ID with permission check
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    let opp = null;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      opp = (fallbackStore.opportunities || []).find((o) => o._id.toString() === id.toString());
    } else {
      allUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      opp = await Opportunity.findById(id);
    }

    if (!opp) return res.status(404).json({ success: false, message: 'Opportunity not found' });

    if (!canUserAccessOpportunity(req.user, opp, allUsers)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view this opportunity',
      });
    }

    return res.json({ success: true, opportunity: opp });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch opportunity', error: error.message });
  }
});

// @route   POST /api/opportunities
// @desc    Create a new opportunity (Super Admin: assign to anyone, Manager/User: assign to self or junior subordinates)
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const {
      name,
      company,
      relatedLead,
      relatedLeadName,
      amount = 0,
      stage = 'Qualification',
      probability,
      expectedCloseDate,
      priority = 'Medium',
      assignedTo,
      notes = '',
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Opportunity name is required' });
    }

    if (stage && !VALID_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        message: `Stage must be one of: ${VALID_STAGES.join(', ')}`,
      });
    }

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}`,
      });
    }

    const targetAssignedTo = (assignedTo && assignedTo.trim()) || req.user?.name || 'Current User';

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

    const calcProbability = probability !== undefined && probability !== '' ? Number(probability) : (DEFAULT_PROBABILITIES[stage] !== undefined ? DEFAULT_PROBABILITIES[stage] : 20);

    const newOppData = {
      name: name.trim(),
      company: (company || '').trim(),
      relatedLead: relatedLead || null,
      relatedLeadName: (relatedLeadName || '').trim(),
      amount: Number(amount) || 0,
      stage: stage || 'Qualification',
      probability: calcProbability,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      priority: priority || 'Medium',
      assignedTo: targetAssignedTo,
      assignedBy,
      assignedById: assignerIdStr,
      user: targetUserId,
      notes: (notes || '').trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const generatedId = '64e8e1' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      const createdOpp = { _id: generatedId, ...newOppData };
      if (!fallbackStore.opportunities) fallbackStore.opportunities = [];
      fallbackStore.opportunities.unshift(createdOpp);
      fallbackStore.saveToFile();

      if (io) {
        io.emit('opportunities:updated', { opportunity: createdOpp, action: 'created' });
      }

      return res.status(201).json({
        success: true,
        message: 'Opportunity created successfully',
        opportunity: createdOpp,
      });
    } else {
      const opportunity = await Opportunity.create(newOppData);

      try {
        if (!fallbackStore.opportunities) fallbackStore.opportunities = [];
        fallbackStore.opportunities.unshift(opportunity.toObject());
        fallbackStore.saveToFile();
      } catch (err) {
        console.warn('Local opportunity backup notice:', err.message);
      }

      if (io) {
        io.emit('opportunities:updated', { opportunity, action: 'created' });
      }

      return res.status(201).json({
        success: true,
        message: 'Opportunity created successfully',
        opportunity,
      });
    }
  } catch (error) {
    console.error('Create opportunity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create opportunity',
      error: error.message,
    });
  }
});

// @route   PUT /api/opportunities/:id
// @desc    Edit and update full opportunity details with role authorization
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      company,
      relatedLead,
      relatedLeadName,
      amount,
      stage,
      probability,
      expectedCloseDate,
      priority,
      assignedTo,
      notes,
    } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ success: false, message: 'Opportunity name cannot be empty' });
    }

    if (stage && !VALID_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        message: `Stage must be one of: ${VALID_STAGES.join(', ')}`,
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
      const oppIndex = (fallbackStore.opportunities || []).findIndex((o) => o._id.toString() === id.toString());
      if (oppIndex === -1) {
        return res.status(404).json({ success: false, message: 'Opportunity not found' });
      }

      const existing = fallbackStore.opportunities[oppIndex];

      if (!canUserAccessOpportunity(req.user, existing, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to edit this opportunity',
        });
      }

      const updated = {
        ...existing,
        name: name !== undefined ? name.trim() : existing.name,
        company: company !== undefined ? company.trim() : existing.company,
        relatedLead: relatedLead !== undefined ? relatedLead : existing.relatedLead,
        relatedLeadName: relatedLeadName !== undefined ? relatedLeadName.trim() : existing.relatedLeadName,
        amount: amount !== undefined ? Number(amount) : existing.amount,
        stage: stage || existing.stage,
        probability: probability !== undefined ? Number(probability) : existing.probability,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : existing.expectedCloseDate,
        priority: priority || existing.priority,
        assignedTo: assignedTo !== undefined ? assignedTo.trim() : existing.assignedTo,
        user: targetUserId !== undefined ? targetUserId : existing.user,
        notes: notes !== undefined ? notes.trim() : existing.notes,
        updatedAt: new Date(),
      };

      fallbackStore.opportunities[oppIndex] = updated;
      fallbackStore.saveToFile();

      if (io) {
        io.emit('opportunities:updated', { opportunity: updated, action: 'updated' });
      }

      return res.json({
        success: true,
        message: 'Opportunity updated successfully',
        opportunity: updated,
      });
    } else {
      let opportunity = await Opportunity.findById(id);
      if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessOpportunity(req.user, opportunity, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to edit this opportunity',
        });
      }

      if (name !== undefined) opportunity.name = name.trim();
      if (company !== undefined) opportunity.company = company.trim();
      if (relatedLead !== undefined) opportunity.relatedLead = relatedLead;
      if (relatedLeadName !== undefined) opportunity.relatedLeadName = relatedLeadName.trim();
      if (amount !== undefined) opportunity.amount = Number(amount);
      if (stage) opportunity.stage = stage;
      if (probability !== undefined) opportunity.probability = Number(probability);
      if (expectedCloseDate) opportunity.expectedCloseDate = new Date(expectedCloseDate);
      if (priority) opportunity.priority = priority;
      if (assignedTo !== undefined) {
        opportunity.assignedTo = assignedTo.trim();
        if (targetUserId) opportunity.user = targetUserId;
      }
      if (notes !== undefined) opportunity.notes = notes.trim();
      opportunity.updatedAt = new Date();

      await opportunity.save();

      try {
        const localIdx = (fallbackStore.opportunities || []).findIndex(o => o._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.opportunities[localIdx] = opportunity.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local opportunity backup update notice:', err.message);
      }

      if (io) {
        io.emit('opportunities:updated', { opportunity, action: 'updated' });
      }

      return res.json({
        success: true,
        message: 'Opportunity updated successfully',
        opportunity,
      });
    }
  } catch (error) {
    console.error('Update opportunity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update opportunity',
      error: error.message,
    });
  }
});

// @route   PATCH /api/opportunities/:id/stage
// @desc    Quick update stage with role authorization (Kanban drag-and-drop / column advancement)
// @access  Private
router.patch('/:id/stage', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, probability } = req.body;

    if (!stage || !VALID_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        message: `Stage must be one of: ${VALID_STAGES.join(', ')}`,
      });
    }

    const finalProbability = probability !== undefined ? Number(probability) : DEFAULT_PROBABILITIES[stage];
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const oppIndex = (fallbackStore.opportunities || []).findIndex((o) => o._id.toString() === id.toString());
      if (oppIndex === -1) {
        return res.status(404).json({ success: false, message: 'Opportunity not found' });
      }

      const existing = fallbackStore.opportunities[oppIndex];

      if (!canUserAccessOpportunity(req.user, existing, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to advance or modify this deal',
        });
      }

      existing.stage = stage;
      if (finalProbability !== undefined) {
        existing.probability = finalProbability;
      }
      existing.updatedAt = new Date();
      fallbackStore.saveToFile();

      if (io) {
        io.emit('opportunities:updated', { opportunity: existing, action: 'stage' });
      }

      return res.json({
        success: true,
        message: `Opportunity stage updated to ${stage}`,
        opportunity: existing,
      });
    } else {
      const opportunity = await Opportunity.findById(id);
      if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessOpportunity(req.user, opportunity, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to advance or modify this deal',
        });
      }

      opportunity.stage = stage;
      if (finalProbability !== undefined) {
        opportunity.probability = finalProbability;
      }
      opportunity.updatedAt = new Date();
      await opportunity.save();

      try {
        const localIdx = (fallbackStore.opportunities || []).findIndex(o => o._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.opportunities[localIdx] = opportunity.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local opportunity stage update notice:', err.message);
      }

      if (io) {
        io.emit('opportunities:updated', { opportunity, action: 'stage' });
      }

      return res.json({
        success: true,
        message: `Opportunity stage updated to ${stage}`,
        opportunity,
      });
    }
  } catch (error) {
    console.error('Update opportunity stage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update opportunity stage',
      error: error.message,
    });
  }
});

// @route   DELETE /api/opportunities/:id
// @desc    Delete an opportunity with role authorization
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const oppIndex = (fallbackStore.opportunities || []).findIndex((o) => o._id.toString() === id.toString());
      if (oppIndex === -1) {
        return res.status(404).json({ success: false, message: 'Opportunity not found' });
      }

      const existing = fallbackStore.opportunities[oppIndex];
      if (!canUserAccessOpportunity(req.user, existing, fallbackStore.users || [])) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to delete this opportunity',
        });
      }

      const deleted = fallbackStore.opportunities.splice(oppIndex, 1)[0];
      fallbackStore.saveToFile();

      if (io) {
        io.emit('opportunities:updated', { id, action: 'deleted' });
      }

      return res.json({
        success: true,
        message: 'Opportunity deleted successfully',
        opportunity: deleted,
      });
    } else {
      const opportunity = await Opportunity.findById(id);
      if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessOpportunity(req.user, opportunity, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to delete this opportunity',
        });
      }

      await Opportunity.findByIdAndDelete(id);

      try {
        const localIdx = (fallbackStore.opportunities || []).findIndex(o => o._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.opportunities.splice(localIdx, 1);
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local opportunity delete notice:', err.message);
      }

      if (io) {
        io.emit('opportunities:updated', { id, action: 'deleted' });
      }

      return res.json({
        success: true,
        message: 'Opportunity deleted successfully',
        opportunity,
      });
    }
  } catch (error) {
    console.error('Delete opportunity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete opportunity',
      error: error.message,
    });
  }
});

module.exports = router;

