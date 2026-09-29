const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Opportunity = require('../models/Opportunity');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

const VALID_STAGES = [
  'New Opportunity',
  'Contacted',
  'Requirement Understanding',
  'Proposal / Quotation',
  'Proposal/Quotation',
  'Negotiation',
  'Won',
  'Lost',
  // Legacy compatibility:
  'Qualification',
  'Needs Analysis',
  'Proposal',
  'Closed Won',
  'Closed Lost',
];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const DEFAULT_PROBABILITIES = {
  'New Opportunity': 10,
  'Contacted': 25,
  'Requirement Understanding': 40,
  'Proposal / Quotation': 60,
  'Proposal/Quotation': 60,
  'Negotiation': 80,
  'Won': 100,
  'Lost': 0,
  'Qualification': 20,
  'Needs Analysis': 40,
  'Proposal': 60,
  'Closed Won': 100,
  'Closed Lost': 0,
};

const LOST_REASONS = [
  'Price too high',
  'Competitor selected',
  'Budget unavailable',
  'Requirement changed',
  'Not interested',
  'Other',
];

const {
  getAllUsers,
  getUserScopeContext,
  isOpportunityAccessible,
  getSubordinateUserIds,
  escapeRegex,
} = require('../services/hierarchyService');

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
const canUserAccessOpportunity = (currentUser, opp, allUsers = []) => {
  if (!currentUser || !opp) return false;
  const scope = getUserScopeContext(currentUser, allUsers);
  return isOpportunityAccessible(scope, opp);
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
            (o.contactPerson && o.contactPerson.toLowerCase().includes(query)) ||
            (o.email && o.email.toLowerCase().includes(query)) ||
            (o.phone && o.phone.toLowerCase().includes(query)) ||
            (o.leadSource && o.leadSource.toLowerCase().includes(query)) ||
            (o.originalLeadId && o.originalLeadId.toLowerCase().includes(query)) ||
            (o.leadId && o.leadId.toLowerCase().includes(query)) ||
            (o.relatedLeadName && o.relatedLeadName.toLowerCase().includes(query)) ||
            (o.lostReason && o.lostReason.toLowerCase().includes(query)) ||
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
            { user: { $in: [req.user._id, ...subordinateIds] } },
            { assignedBy: new RegExp(escapeRegex(userName), 'i') },
          ],
        });
      }

      if (assignedTo && assignedTo !== 'all') {
        andConditions.push({
          $or: [{ assignedTo: new RegExp('^' + escapeRegex(assignedTo.trim()) + '$', 'i') }],
        });
      }

      if (search && search.trim() !== '') {
        const regex = new RegExp(escapeRegex(search.trim()), 'i');
        const searchConditions = [
          { name: regex },
          { company: regex },
          { contactPerson: regex },
          { email: regex },
          { phone: regex },
          { leadSource: regex },
          { originalLeadId: regex },
          { leadId: regex },
          { relatedLeadName: regex },
          { lostReason: regex },
          { notes: regex },
          { assignedTo: regex },
        ];
        andConditions.push({ $or: searchConditions });
      }

      if (andConditions.length > 0) {
        queryObj.$and = andConditions;
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
    const wonDeals = userOpps.filter((o) => o.stage === 'Won' || o.stage === 'Closed Won');
    const wonValue = wonDeals.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const lostDeals = userOpps.filter((o) => o.stage === 'Lost' || o.stage === 'Closed Lost');
    const closedDealsCount = wonDeals.length + lostDeals.length;
    const winRate = closedDealsCount > 0 ? Math.round((wonDeals.length / closedDealsCount) * 100) : (totalDeals > 0 ? Math.round((wonDeals.length / totalDeals) * 100) : 0);

    const getStageStats = (stageNames) => {
      const matching = userOpps.filter((o) => stageNames.includes(o.stage));
      return {
        count: matching.length,
        value: matching.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
      };
    };

    const stageBreakdown = {
      'New Opportunity': getStageStats(['New Opportunity', 'Qualification']),
      Contacted: getStageStats(['Contacted']),
      'Requirement Understanding': getStageStats(['Requirement Understanding', 'Needs Analysis']),
      'Proposal / Quotation': getStageStats(['Proposal / Quotation', 'Proposal/Quotation', 'Proposal']),
      Negotiation: getStageStats(['Negotiation']),
      Won: {
        count: wonDeals.length,
        value: wonValue,
      },
      Lost: {
        count: lostDeals.length,
        value: lostDeals.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
      },
    };

    const lostReasonsBreakdown = LOST_REASONS.reduce((acc, reason) => {
      acc[reason] = userOpps.filter((o) => (o.stage === 'Lost' || o.stage === 'Closed Lost') && o.lostReason === reason).length;
      return acc;
    }, {});

    res.json({
      success: true,
      stats: {
        totalDeals,
        totalPipelineValue,
        wonValue,
        winRate,
        stageBreakdown,
        lostReasonsBreakdown,
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
      opp = (fallbackStore.opportunities || []).find(
        (o) =>
          (o._id && o._id.toString() === id.toString()) ||
          o.opportunityId === id ||
          o.opportunity_id === id ||
          o.originalLeadId === id ||
          o.leadId === id ||
          (o.relatedLead && o.relatedLead.toString() === id.toString())
      );
    } else {
      allUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (mongoose.Types.ObjectId.isValid(id)) {
        opp = await Opportunity.findById(id);
      }
      if (!opp) {
        opp = await Opportunity.findOne({
          $or: [
            { opportunityId: id },
            { opportunity_id: id },
            { originalLeadId: id },
            { leadId: id },
            ...(mongoose.Types.ObjectId.isValid(id) ? [{ relatedLead: id }] : []),
          ],
        });
      }
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
      opportunityName,
      company,
      contactPerson,
      email,
      phone,
      leadSource,
      leadId,
      originalLeadId,
      relatedLead,
      relatedLeadName,
      amount = 0,
      dealValue = 0,
      stage = 'New Opportunity',
      probability,
      expectedCloseDate,
      priority = 'Medium',
      assignedTo,
      notes = '',
      remarks = '',
      lostReason = '',
      lostReasonDetails = '',
    } = req.body;

    const oppTitle = (name && name.trim()) || (opportunityName && opportunityName.trim());
    if (!oppTitle) {
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

    const calcProbability = probability !== undefined && probability !== '' ? Number(probability) : (DEFAULT_PROBABILITIES[stage] !== undefined ? DEFAULT_PROBABILITIES[stage] : 10);
    const finalVal = Number(dealValue) || Number(amount) || 0;
    const finalNotes = (notes || remarks || '').trim();
    const finalLeadId = (leadId || originalLeadId || '').trim();

    const isWon = stage === 'Won' || stage === 'Closed Won';
    const isLost = stage === 'Lost' || stage === 'Closed Lost';

    const newOppData = {
      name: oppTitle,
      opportunityName: oppTitle,
      company: (company || '').trim(),
      contactPerson: (contactPerson || '').trim(),
      email: (email || '').trim().toLowerCase(),
      phone: (phone || '').trim(),
      leadSource: (leadSource || 'Website').trim(),
      campaign_source: (leadSource || 'Website Direct').trim(),
      leadId: finalLeadId,
      originalLeadId: finalLeadId,
      relatedLead: relatedLead || null,
      relatedLeadName: (relatedLeadName || '').trim(),
      sourceLeadName: (relatedLeadName || '').trim(),
      amount: finalVal,
      dealValue: finalVal,
      pipeline_value: finalVal,
      stage: stage || 'New Opportunity',
      opportunity_stage: (stage || 'New Opportunity').toUpperCase().replace(/[\s\/]+/g, '_'),
      lostReason: isLost ? (lostReason || '').trim() : '',
      lostReasonDetails: isLost ? (lostReasonDetails || '').trim() : '',
      wonAt: isWon ? new Date() : null,
      lostAt: isLost ? new Date() : null,
      probability: calcProbability,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      priority: priority || 'Medium',
      assignedTo: targetAssignedTo,
      assignedBy,
      assignedById: assignerIdStr,
      user: targetUserId,
      notes: finalNotes,
      remarks: finalNotes,
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
      opportunityName,
      company,
      contactPerson,
      email,
      phone,
      leadSource,
      leadId,
      originalLeadId,
      relatedLead,
      relatedLeadName,
      amount,
      dealValue,
      stage,
      probability,
      expectedCloseDate,
      priority,
      assignedTo,
      notes,
      remarks,
      lostReason,
      lostReasonDetails,
    } = req.body;

    const oppTitle = (name !== undefined ? name.trim() : (opportunityName !== undefined ? opportunityName.trim() : undefined));
    if (oppTitle !== undefined && !oppTitle) {
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

      const targetStage = stage || existing.stage;
      const isWon = targetStage === 'Won' || targetStage === 'Closed Won';
      const isLost = targetStage === 'Lost' || targetStage === 'Closed Lost';

      const val = amount !== undefined ? Number(amount) : (dealValue !== undefined ? Number(dealValue) : existing.amount);
      const textNotes = notes !== undefined ? notes.trim() : (remarks !== undefined ? remarks.trim() : existing.notes);
      const finalLeadId = leadId !== undefined ? leadId.trim() : (originalLeadId !== undefined ? originalLeadId.trim() : existing.leadId);

      const updated = {
        ...existing,
        name: oppTitle !== undefined ? oppTitle : existing.name,
        opportunityName: oppTitle !== undefined ? oppTitle : existing.opportunityName,
        company: company !== undefined ? company.trim() : existing.company,
        contactPerson: contactPerson !== undefined ? contactPerson.trim() : existing.contactPerson,
        email: email !== undefined ? email.trim().toLowerCase() : existing.email,
        phone: phone !== undefined ? phone.trim() : existing.phone,
        leadSource: leadSource !== undefined ? leadSource.trim() : existing.leadSource,
        campaign_source: leadSource !== undefined ? leadSource.trim() : existing.campaign_source,
        leadId: finalLeadId,
        originalLeadId: finalLeadId,
        relatedLead: relatedLead !== undefined ? relatedLead : existing.relatedLead,
        relatedLeadName: relatedLeadName !== undefined ? relatedLeadName.trim() : existing.relatedLeadName,
        sourceLeadName: relatedLeadName !== undefined ? relatedLeadName.trim() : existing.sourceLeadName,
        amount: val,
        dealValue: val,
        pipeline_value: val,
        stage: targetStage,
        opportunity_stage: targetStage.toUpperCase().replace(/[\s\/]+/g, '_'),
        lostReason: isLost ? (lostReason !== undefined ? lostReason.trim() : existing.lostReason || '') : '',
        lostReasonDetails: isLost ? (lostReasonDetails !== undefined ? lostReasonDetails.trim() : existing.lostReasonDetails || '') : '',
        wonAt: isWon ? (existing.wonAt || new Date()) : null,
        lostAt: isLost ? (existing.lostAt || new Date()) : null,
        probability: probability !== undefined ? Number(probability) : existing.probability,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : existing.expectedCloseDate,
        priority: priority || existing.priority,
        assignedTo: assignedTo !== undefined ? assignedTo.trim() : existing.assignedTo,
        user: targetUserId !== undefined ? targetUserId : existing.user,
        notes: textNotes,
        remarks: textNotes,
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

      if (oppTitle !== undefined) {
        opportunity.name = oppTitle;
        opportunity.opportunityName = oppTitle;
      }
      if (company !== undefined) opportunity.company = company.trim();
      if (contactPerson !== undefined) opportunity.contactPerson = contactPerson.trim();
      if (email !== undefined) opportunity.email = email.trim().toLowerCase();
      if (phone !== undefined) opportunity.phone = phone.trim();
      if (leadSource !== undefined) {
        opportunity.leadSource = leadSource.trim();
        opportunity.campaign_source = leadSource.trim();
      }
      if (leadId !== undefined || originalLeadId !== undefined) {
        const lid = (leadId || originalLeadId || '').trim();
        opportunity.leadId = lid;
        opportunity.originalLeadId = lid;
      }
      if (relatedLead !== undefined) opportunity.relatedLead = relatedLead;
      if (relatedLeadName !== undefined) {
        opportunity.relatedLeadName = relatedLeadName.trim();
        opportunity.sourceLeadName = relatedLeadName.trim();
      }
      if (amount !== undefined || dealValue !== undefined) {
        const val = amount !== undefined ? Number(amount) : Number(dealValue);
        opportunity.amount = val;
        opportunity.dealValue = val;
        opportunity.pipeline_value = val;
      }
      if (stage) {
        opportunity.stage = stage;
        opportunity.opportunity_stage = stage.toUpperCase().replace(/[\s\/]+/g, '_');
        if (stage === 'Won' || stage === 'Closed Won') {
          if (!opportunity.wonAt) opportunity.wonAt = new Date();
          opportunity.lostAt = null;
          opportunity.lostReason = '';
          opportunity.lostReasonDetails = '';
        } else if (stage === 'Lost' || stage === 'Closed Lost') {
          if (!opportunity.lostAt) opportunity.lostAt = new Date();
          opportunity.wonAt = null;
          if (lostReason !== undefined) opportunity.lostReason = lostReason.trim();
          if (lostReasonDetails !== undefined) opportunity.lostReasonDetails = lostReasonDetails.trim();
        } else {
          opportunity.wonAt = null;
          opportunity.lostAt = null;
          opportunity.lostReason = '';
          opportunity.lostReasonDetails = '';
        }
      }
      if (lostReason !== undefined && (opportunity.stage === 'Lost' || opportunity.stage === 'Closed Lost')) {
        opportunity.lostReason = lostReason.trim();
      }
      if (lostReasonDetails !== undefined && (opportunity.stage === 'Lost' || opportunity.stage === 'Closed Lost')) {
        opportunity.lostReasonDetails = lostReasonDetails.trim();
      }
      if (probability !== undefined) opportunity.probability = Number(probability);
      if (expectedCloseDate) opportunity.expectedCloseDate = new Date(expectedCloseDate);
      if (priority) opportunity.priority = priority;
      if (assignedTo !== undefined) {
        opportunity.assignedTo = assignedTo.trim();
        if (targetUserId) opportunity.user = targetUserId;
      }
      if (notes !== undefined || remarks !== undefined) {
        const txt = (notes || remarks || '').trim();
        opportunity.notes = txt;
        opportunity.remarks = txt;
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
// @desc    Quick update stage with role authorization (Kanban drag-and-drop / column advancement / Lost reason capture)
// @access  Private
router.patch('/:id/stage', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, probability, lostReason, lostReasonDetails } = req.body;

    if (!stage || !VALID_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        message: `Stage must be one of: ${VALID_STAGES.join(', ')}`,
      });
    }

    const finalProbability = probability !== undefined ? Number(probability) : DEFAULT_PROBABILITIES[stage];
    const isWon = stage === 'Won' || stage === 'Closed Won';
    const isLost = stage === 'Lost' || stage === 'Closed Lost';
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const oppIndex = (fallbackStore.opportunities || []).findIndex(
        (o) =>
          (o._id && o._id.toString() === id.toString()) ||
          o.opportunityId === id ||
          o.opportunity_id === id ||
          o.originalLeadId === id ||
          o.leadId === id ||
          (o.relatedLead && o.relatedLead.toString() === id.toString())
      );
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
      existing.opportunity_stage = stage.toUpperCase().replace(/[\s\/]+/g, '_');
      if (finalProbability !== undefined) {
        existing.probability = finalProbability;
      }

      if (isWon) {
        existing.wonAt = new Date();
        existing.lostAt = null;
        existing.lostReason = '';
        existing.lostReasonDetails = '';
      } else if (isLost) {
        existing.lostAt = new Date();
        existing.wonAt = null;
        if (lostReason !== undefined) existing.lostReason = (lostReason || '').trim();
        if (lostReasonDetails !== undefined) existing.lostReasonDetails = (lostReasonDetails || '').trim();
      } else {
        existing.wonAt = null;
        existing.lostAt = null;
        existing.lostReason = '';
        existing.lostReasonDetails = '';
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
      let opportunity = null;
      if (mongoose.Types.ObjectId.isValid(id)) {
        opportunity = await Opportunity.findById(id);
      }
      if (!opportunity) {
        opportunity = await Opportunity.findOne({
          $or: [
            { opportunityId: id },
            { opportunity_id: id },
            { originalLeadId: id },
            { leadId: id },
            ...(mongoose.Types.ObjectId.isValid(id) ? [{ relatedLead: id }] : []),
          ],
        });
      }
      if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found' });

      const allDbUsers = await User.find({}).select('_id name username reportsTo reportsToName createdBy').lean();
      if (!canUserAccessOpportunity(req.user, opportunity, allDbUsers)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to advance or modify this deal',
        });
      }

      opportunity.stage = stage;
      opportunity.opportunity_stage = stage.toUpperCase().replace(/[\s\/]+/g, '_');
      if (finalProbability !== undefined) {
        opportunity.probability = finalProbability;
      }

      if (isWon) {
        opportunity.wonAt = new Date();
        opportunity.lostAt = null;
        opportunity.lostReason = '';
        opportunity.lostReasonDetails = '';
      } else if (isLost) {
        opportunity.lostAt = new Date();
        opportunity.wonAt = null;
        if (lostReason !== undefined) opportunity.lostReason = (lostReason || '').trim();
        if (lostReasonDetails !== undefined) opportunity.lostReasonDetails = (lostReasonDetails || '').trim();
      } else {
        opportunity.wonAt = null;
        opportunity.lostAt = null;
        opportunity.lostReason = '';
        opportunity.lostReasonDetails = '';
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

