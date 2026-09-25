const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// Helper to check if Project Management module is active
const isProjectModuleActive = () => {
  const activeMods = fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects'];
  return activeMods.includes('projects');
};

// Middleware to enforce module enablement
const requireProjectModule = (req, res, next) => {
  if (!isProjectModuleActive()) {
    return res.status(403).json({
      success: false,
      moduleDisabled: true,
      message: 'Project Management module is not activated for your organization.',
    });
  }
  next();
};

// Helper to generate project code
const generateProjectCode = (existingProjects = []) => {
  const count = existingProjects.length + 1;
  const rand = Math.floor(100 + Math.random() * 900);
  return `PRJ-${count < 10 ? '0' + count : count}-${rand}`;
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
 * Checks if a user can access a project (Super Admin = all, Manager = team/subordinates + self, User = subordinates + self)
 */
const canUserAccessProject = (currentUser, project, allUsers) => {
  if (!currentUser || !project) return false;
  const userRoles = Array.isArray(currentUser.roles) && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role || 'User'];
  if (userRoles.includes('Super Admin')) return true;

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

  // Check Manager
  const pManagerId = project.manager ? (project.manager._id ? project.manager._id.toString() : project.manager.toString()) : '';
  const pManagerName = (project.managerName || '').toLowerCase().trim();
  if (pManagerId && allowedIds.has(pManagerId)) return true;
  if (pManagerName && allowedNames.has(pManagerName)) return true;

  // Check CreatedBy
  const pCreatedById = project.createdBy ? (project.createdBy._id ? project.createdBy._id.toString() : project.createdBy.toString()) : '';
  if (pCreatedById && allowedIds.has(pCreatedById)) return true;

  // Check Team Members
  const isTeamMatch = (project.teamMembers || []).some((m) => {
    const mUserId = m.userId ? (m.userId._id ? m.userId._id.toString() : m.userId.toString()) : (m.user ? (m.user._id ? m.user._id.toString() : m.user.toString()) : '');
    const mName = (m.name || m.userName || '').toLowerCase().trim();
    return (mUserId && allowedIds.has(mUserId)) || (mName && allowedNames.has(mName));
  });

  return isTeamMatch;
};

// @route   GET /api/projects
// @desc    Get all projects with multi-filter, search, pagination, and stats
// @access  Private
router.get('/', protect, requireProjectModule, async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      priority = 'all',
      category = 'all',
      manager = 'all',
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageLimit = Math.max(1, parseInt(limit, 10));

    let projectsList = [];
    let allUsers = [];

    if (fallbackStore.isFallback) {
      projectsList = [...(fallbackStore.projects || [])];
      allUsers = fallbackStore.users || [];
    } else {
      const dbProjects = await Project.find({}).sort({ createdAt: -1 });
      projectsList = dbProjects.map((p) => p.toObject());
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    // Role-based scoping: Super Admin gets all, Manager gets team/assigned, User gets own + subordinates
    const user = req.user;
    const userRoles = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role || 'User'];
    const isSuperAdmin = userRoles.includes('Super Admin');

    if (!isSuperAdmin) {
      projectsList = projectsList.filter((p) => canUserAccessProject(user, p, allUsers));
    }

    // Global Stats before filters
    const totalBudget = projectsList.reduce((acc, p) => acc + (Number(p.budget) || 0), 0);
    const avgProgress =
      projectsList.length > 0
        ? Math.round(projectsList.reduce((acc, p) => acc + (Number(p.progress) || 0), 0) / projectsList.length)
        : 0;

    const stats = {
      total: projectsList.length,
      planning: projectsList.filter((p) => p.status === 'Planning').length,
      inProgress: projectsList.filter((p) => p.status === 'In Progress').length,
      completed: projectsList.filter((p) => p.status === 'Completed').length,
      onHold: projectsList.filter((p) => p.status === 'On Hold').length,
      totalBudget,
      avgProgress,
    };

    // Apply filters
    let filtered = projectsList;

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(
        (p) =>
          (p.projectCode && p.projectCode.toLowerCase().includes(q)) ||
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.clientName && p.clientName.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          (p.managerName && p.managerName.toLowerCase().includes(q))
      );
    }

    if (status && status !== 'all') {
      filtered = filtered.filter((p) => p.status === status);
    }

    if (priority && priority !== 'all') {
      filtered = filtered.filter((p) => p.priority === priority);
    }

    if (category && category !== 'all') {
      filtered = filtered.filter((p) => p.category === category);
    }

    if (manager && manager !== 'all') {
      filtered = filtered.filter(
        (p) =>
          p.managerName &&
          p.managerName.toLowerCase().includes(manager.toLowerCase().trim())
      );
    }

    // Pagination
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / pageLimit) || 1;
    const startIndex = (pageNum - 1) * pageLimit;
    const paginatedProjects = filtered.slice(startIndex, startIndex + pageLimit);

    return res.json({
      success: true,
      projects: paginatedProjects,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: pageLimit,
        totalPages,
      },
      stats,
    });
  } catch (err) {
    console.error('[Get Projects Error]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch projects' });
  }
});

// @route   GET /api/projects/:id
// @desc    Get single project
// @access  Private
router.get('/:id', protect, requireProjectModule, async (req, res) => {
  try {
    let project;
    let allUsers = [];
    if (fallbackStore.isFallback) {
      project = (fallbackStore.projects || []).find((p) => p._id.toString() === req.params.id);
      allUsers = fallbackStore.users || [];
    } else {
      project = await Project.findById(req.params.id);
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const projectObj = typeof project.toObject === 'function' ? project.toObject() : project;

    if (!canUserAccessProject(req.user, projectObj, allUsers)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this project' });
    }

    return res.json({ success: true, project: projectObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error retrieving project' });
  }
});

// @route   POST /api/projects
// @desc    Create a new project
// @access  Private
router.post('/', protect, requireProjectModule, async (req, res) => {
  try {
    const {
      name,
      clientName,
      description = '',
      category = 'Web Application',
      priority = 'Medium',
      budget = 0,
      currency = 'USD',
      startDate,
      targetDate,
      manager = null,
      managerName = 'Unassigned',
      teamMembers = [],
      milestones = [],
      title,
    } = req.body;

    const projectName = (name || title || '').trim();
    const finalTargetDate = targetDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (!projectName || !clientName) {
      return res.status(400).json({
        success: false,
        message: 'Project name and client name are required.',
      });
    }

    // Default milestones if none provided
    const initialMilestones =
      milestones && milestones.length > 0
        ? milestones
        : [
            { title: 'Project Kickoff & Scope Alignment', isCompleted: true, completedAt: new Date().toISOString() },
            { title: 'Architecture & Design Approval', isCompleted: false },
            { title: 'Core Implementation & QA Testing', isCompleted: false },
            { title: 'Final Handover & Client Sign-off', isCompleted: false },
          ];

    const completedCount = initialMilestones.filter((m) => m.isCompleted).length;
    const progress = Math.round((completedCount / initialMilestones.length) * 100);

    let newProject;
    if (fallbackStore.isFallback) {
      const projectCode = generateProjectCode(fallbackStore.projects || []);
      newProject = {
        _id: 'prj_' + Date.now(),
        projectCode,
        name: projectName,
        clientName: clientName.trim(),
        description: description.trim(),
        category,
        status: progress === 100 ? 'Completed' : progress > 0 ? 'In Progress' : 'Planning',
        priority,
        budget: Number(budget) || 0,
        currency,
        startDate: startDate ? new Date(startDate).toISOString() : new Date().toISOString(),
        targetDate: finalTargetDate,
        progress,
        manager: manager || null,
        managerName: managerName || 'Unassigned',
        teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
        milestones: initialMilestones,
        deliverableTasks: [],
        attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
        createdBy: req.user._id ? req.user._id.toString() : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (!fallbackStore.projects) fallbackStore.projects = [];
      fallbackStore.projects.unshift(newProject);
      fallbackStore.saveToFile();
    } else {
      const allCount = await Project.countDocuments();
      const projectCode = `PRJ-${(allCount + 1).toString().padStart(4, '0')}`;

      newProject = await Project.create({
        projectCode,
        name: projectName,
        clientName: clientName.trim(),
        description: description.trim(),
        category,
        status: progress === 100 ? 'Completed' : progress > 0 ? 'In Progress' : 'Planning',
        priority,
        budget: Number(budget) || 0,
        currency,
        startDate: startDate || new Date(),
        targetDate: finalTargetDate,
        progress,
        manager: manager || null,
        managerName: managerName || 'Unassigned',
        teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
        milestones: initialMilestones,
        attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
        createdBy: req.user._id,
      });
      newProject = newProject.toObject();
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('project_created', newProject);
      io.emit('notification', {
        type: 'project_created',
        title: `New Project: ${newProject.name}`,
        message: `${newProject.clientName} - Budget: ${newProject.currency} ${newProject.budget}`,
        timestamp: new Date(),
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: newProject,
    });
  } catch (err) {
    console.error('[Create Project Error]', err);
    res.status(500).json({ success: false, message: 'Failed to create project' });
  }
});

// @route   PUT /api/projects/:id
// @desc    Update project details
// @access  Private
router.put('/:id', protect, requireProjectModule, async (req, res) => {
  try {
    const {
      name,
      clientName,
      description,
      category,
      status,
      priority,
      budget,
      currency,
      startDate,
      targetDate,
      progress,
      manager,
      managerName,
      teamMembers,
      milestones,
    } = req.body;

    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
    } else {
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    let updatedProject;

    if (fallbackStore.isFallback) {
      const index = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }

      const existing = fallbackStore.projects[index];
      if (!canUserAccessProject(req.user, existing, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to edit this project' });
      }

      let newMilestones = milestones !== undefined ? milestones : existing.milestones;
      let newProgress = progress !== undefined ? Number(progress) : existing.progress;

      if (milestones && milestones.length > 0) {
        const completed = milestones.filter((m) => m.isCompleted).length;
        newProgress = Math.round((completed / milestones.length) * 100);
      }

      const updated = {
        ...existing,
        name: name !== undefined ? name : existing.name,
        clientName: clientName !== undefined ? clientName : existing.clientName,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        status: status !== undefined ? status : newProgress === 100 ? 'Completed' : existing.status,
        priority: priority !== undefined ? priority : existing.priority,
        budget: budget !== undefined ? Number(budget) : existing.budget,
        currency: currency !== undefined ? currency : existing.currency,
        startDate: startDate !== undefined ? startDate : existing.startDate,
        targetDate: targetDate !== undefined ? targetDate : existing.targetDate,
        progress: newProgress,
        manager: manager !== undefined ? manager : existing.manager,
        managerName: managerName !== undefined ? managerName : existing.managerName,
        teamMembers: teamMembers !== undefined ? teamMembers : existing.teamMembers,
        milestones: newMilestones,
        attachments: req.body.attachments !== undefined ? req.body.attachments : (existing.attachments || []),
        updatedAt: new Date().toISOString(),
      };

      fallbackStore.projects[index] = updated;
      fallbackStore.saveToFile();
      updatedProject = updated;
    } else {
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }

      if (!canUserAccessProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to edit this project' });
      }

      if (name !== undefined) project.name = name;
      if (clientName !== undefined) project.clientName = clientName;
      if (description !== undefined) project.description = description;
      if (category !== undefined) project.category = category;
      if (priority !== undefined) project.priority = priority;
      if (budget !== undefined) project.budget = Number(budget);
      if (currency !== undefined) project.currency = currency;
      if (startDate !== undefined) project.startDate = startDate;
      if (targetDate !== undefined) project.targetDate = targetDate;
      if (manager !== undefined) project.manager = manager;
      if (managerName !== undefined) project.managerName = managerName;
      if (teamMembers !== undefined) project.teamMembers = teamMembers;
      if (req.body.attachments !== undefined) project.attachments = req.body.attachments;

      if (milestones !== undefined) {
        project.milestones = milestones;
      }
      if (status !== undefined) {
        project.status = status;
      }

      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('project_updated', updatedProject);
    }

    return res.json({
      success: true,
      message: 'Project updated successfully',
      project: updatedProject,
    });
  } catch (err) {
    console.error('[Update Project Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update project' });
  }
});

// @route   PUT /api/projects/:id/milestones/:index/toggle
// @desc    Toggle milestone completion and recalculate progress %
// @access  Private
router.put('/:id/milestones/:index/toggle', protect, requireProjectModule, async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    let updatedProject;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      const pIdx = (fallbackStore.projects || []).findIndex((p) => p._id.toString() === req.params.id);
      if (pIdx === -1) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      const project = fallbackStore.projects[pIdx];
      if (!canUserAccessProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to update milestones for this project' });
      }

      if (!project.milestones || !project.milestones[idx]) {
        return res.status(404).json({ success: false, message: 'Milestone index not found' });
      }

      const targetMilestone = project.milestones[idx];
      targetMilestone.isCompleted = !targetMilestone.isCompleted;
      targetMilestone.completedAt = targetMilestone.isCompleted ? new Date().toISOString() : null;

      const completed = project.milestones.filter((m) => m.isCompleted).length;
      project.progress = Math.round((completed / project.milestones.length) * 100);
      if (project.progress === 100) project.status = 'Completed';
      else if (project.progress > 0 && project.status === 'Planning') project.status = 'In Progress';

      project.updatedAt = new Date().toISOString();
      fallbackStore.projects[pIdx] = project;
      fallbackStore.saveToFile();
      updatedProject = project;
    } else {
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
      const project = await Project.findById(req.params.id);
      if (!project || !project.milestones || !project.milestones[idx]) {
        return res.status(404).json({ success: false, message: 'Project or milestone not found' });
      }

      if (!canUserAccessProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to update milestones for this project' });
      }

      const target = project.milestones[idx];
      target.isCompleted = !target.isCompleted;
      target.completedAt = target.isCompleted ? new Date() : null;

      await project.save();
      updatedProject = project.toObject();
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('project_updated', updatedProject);
    }

    return res.json({
      success: true,
      message: 'Milestone status updated',
      project: updatedProject,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to toggle milestone' });
  }
});

// @route   DELETE /api/projects/:id
// @desc    Delete project
// @access  Private (Super Admin / Manager / Project Owner)
router.delete('/:id', protect, requireProjectModule, async (req, res) => {
  try {
    let deleted;
    let allUsers = [];

    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users || [];
      const project = (fallbackStore.projects || []).find((p) => p._id.toString() === req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      if (!canUserAccessProject(req.user, project, allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to delete this project' });
      }

      const initLen = (fallbackStore.projects || []).length;
      fallbackStore.projects = (fallbackStore.projects || []).filter((p) => p._id.toString() !== req.params.id);
      if (fallbackStore.projects.length !== initLen) {
        deleted = true;
        fallbackStore.saveToFile();
      }
    } else {
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      if (!canUserAccessProject(req.user, project.toObject(), allUsers)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to delete this project' });
      }

      const resDel = await Project.findByIdAndDelete(req.params.id);
      if (resDel) deleted = true;
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('project_deleted', { id: req.params.id });
    }

    return res.json({ success: true, message: 'Project deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete project' });
  }
});

module.exports = router;
