const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

const VALID_TASK_TYPES = ['internet work', 'documentation', 'social media', 'backend work', 'sells', 'sales'];
const VALID_STATUSES = ['To Do', 'In Progress', 'Completed'];

// Safe regex character escaper
const escapeRegex = (str) => (str ? str.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '');

// Helper to create Notification when a task is completed or remarked
// The completion report is dispatched directly to the assigner who assigned the task
const createManagerNotification = async (task, user, completionRemark = '', io = null) => {
  try {
    const userName = user?.name || task.assignedTo || 'Team Member';
    const userAvatar = user?.avatar || '';
    const taskDesc = task.description || 'Assigned Task';
    const shortDesc = taskDesc.length > 55 ? taskDesc.substring(0, 52) + '...' : taskDesc;
    const remarkText = completionRemark || task.completionRemark || task.remark || 'Marked as completed';

    // Find the specific assigner user who assigned this task
    let allUsers = [];
    if (fallbackStore.isFallback) {
      allUsers = fallbackStore.users;
    } else {
      allUsers = await User.find({}).select('_id name username email role').lean();
    }

    let assignerUser = null;
    if (task.assignedById) {
      assignerUser = allUsers.find(u => u && u._id && u._id.toString() === task.assignedById.toString());
    }
    if (!assignerUser && task.assignedBy) {
      const cleanAssigner = task.assignedBy.replace(/\s*\(.*?\)\s*$/, '').trim().toLowerCase();
      assignerUser = allUsers.find(u =>
        (u.name && u.name.trim().toLowerCase() === cleanAssigner) ||
        (u.username && u.username.trim().toLowerCase() === cleanAssigner) ||
        (u.email && u.email.trim().toLowerCase() === cleanAssigner)
      );
    }

    const safeAssignerId = assignerUser && assignerUser._id ? (assignerUser._id.toString ? assignerUser._id.toString() : assignerUser._id) : undefined;
    const safeUserId = user && user._id
      ? (user._id.toString ? user._id.toString() : user._id)
      : (task.user ? (task.user.toString ? task.user.toString() : task.user) : undefined);

    const safeTaskId = task && task._id
      ? (task._id.toString ? task._id.toString() : task._id)
      : undefined;

    const notifData = {
      user: safeUserId,
      recipientUser: safeAssignerId,
      recipientName: assignerUser?.name || task.assignedBy || 'Manager',
      userName: userName,
      userAvatar: userAvatar,
      assignedBy: task.assignedBy || 'Manager',
      taskId: safeTaskId,
      taskDescription: taskDesc,
      taskType: task.taskType || 'internet work',
      type: 'task_completed',
      title: `Task Completed: ${userName}`,
      message: `${userName} has completed "${shortDesc}"`,
      remark: remarkText,
      isRead: false,
      forRole: assignerUser?.role === 'Manager' ? 'Manager' : (assignerUser ? 'User' : 'Manager'),
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

    // Instant Real-Time Socket.io dispatch directly to the assigner & Managers
    if (io) {
      const payload = {
        notification: createdNotif,
        task: task,
        type: 'task_completed',
        title: `Task Completed: ${userName}`,
        message: `${userName} completed "${shortDesc}"`,
        remark: remarkText,
      };

      if (safeAssignerId) {
        io.to(`user:${safeAssignerId.toString()}`).emit('notification:new', payload);
        io.to(`user:${safeAssignerId.toString()}`).emit('task:completed', { task, notification: createdNotif });
      }
      if (assignerUser?.name) {
        const cleanName = assignerUser.name.toLowerCase().trim();
        io.to(`user:${cleanName}`).emit('notification:new', payload);
        io.to(`user:${cleanName}`).emit('task:completed', { task, notification: createdNotif });
      }
      io.emit('tasks:updated', { task, action: 'completed' });
      io.emit('stats:updated');
    }
  } catch (err) {
    console.error('[Task Completion Notification Helper Error]', err.message);
  }
};

// Helper to create User Notification when manager assigns a task
const createUserAssignmentNotification = async (task, targetAssignedTo, targetUserId, managerUser, io = null) => {
  try {
    const assignedBy = managerUser ? `${managerUser.name} (${managerUser.role || 'Manager'})` : 'Manager';
    const taskDesc = task.description || 'Assigned Task';
    const shortDesc = taskDesc.length > 55 ? taskDesc.substring(0, 52) + '...' : taskDesc;
    const instructions = task.remark ? `Instructions: ${task.remark}` : 'Please review the task details and start working on it.';

    const safeManagerId = managerUser && managerUser._id
      ? (managerUser._id.toString ? managerUser._id.toString() : managerUser._id)
      : undefined;

    const safeRecipientId = targetUserId
      ? (targetUserId.toString ? targetUserId.toString() : targetUserId)
      : undefined;

    const safeTaskId = task && task._id
      ? (task._id.toString ? task._id.toString() : task._id)
      : undefined;

    const notifData = {
      user: safeManagerId,
      recipientUser: safeRecipientId,
      recipientName: targetAssignedTo || '',
      userName: managerUser?.name || 'Manager',
      userAvatar: managerUser?.avatar || '',
      assignedBy: assignedBy,
      taskId: safeTaskId,
      taskDescription: taskDesc,
      taskType: task.taskType || 'internet work',
      type: 'task_assigned',
      title: `New Task Assigned by ${assignedBy}`,
      message: `${assignedBy} assigned you a task: "${shortDesc}"`,
      remark: instructions,
      isRead: false,
      forRole: 'User',
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

    // Instant Real-Time Socket.io dispatch to Target User & Managers
    if (io) {
      const payload = {
        notification: createdNotif,
        task: task,
        type: 'task_assigned',
        title: `New Task Assigned by ${assignedBy}`,
        message: `${assignedBy} assigned you: "${shortDesc}"`,
        remark: instructions,
      };

      if (targetUserId) {
        io.to(`user:${targetUserId.toString()}`).emit('notification:new', payload);
        io.to(`user:${targetUserId.toString()}`).emit('task:assigned', { task, notification: createdNotif });
      }
      if (targetAssignedTo) {
        const cleanName = targetAssignedTo.toString().toLowerCase().trim();
        io.to(`user:${cleanName}`).emit('notification:new', payload);
        io.to(`user:${cleanName}`).emit('task:assigned', { task, notification: createdNotif });
      }
      io.emit('tasks:updated', { task, action: 'created' });
      io.emit('stats:updated');
    }
  } catch (err) {
    console.error('[User Assignment Notification Helper Error]', err.message);
  }
};

/**
 * Helper to get all user IDs that are subordinate to (under) the assigner in hierarchy
 * Performs a BFS traversal down the hierarchy tree (reportsTo / createdBy / reportsToName)
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
 * Validates organizational hierarchy task assignment rules:
 * 1. Super Admin can assign tasks to any user across the organization (all juniors below Super Admin).
 * 2. Managers can assign tasks to ALL users who are under them in hierarchy (direct & indirect recursive subordinates).
 * 3. Regular Users can assign tasks to ALL users who are under them in hierarchy (direct & indirect recursive subordinates).
 * 4. Nobody can assign tasks to seniors (e.g. User cannot assign to Manager/Super Admin, Manager cannot assign to Super Admin).
 * 5. Nobody can assign tasks to themselves.
 * 6. Users cannot assign tasks to peers who do not report to them in hierarchy.
 */
const validateHierarchyAssignment = async (assignerUser, targetAssignedTo) => {
  if (!assignerUser || !targetAssignedTo) return { valid: true };

  const assignerRole = assignerUser.role || 'User';
  const isSuperAdmin = assignerRole === 'Super Admin';
  const isManager = ['Manager', 'Executive', 'Administrator'].includes(assignerRole);
  const assignerId = (assignerUser._id ? assignerUser._id.toString() : (assignerUser.id ? assignerUser.id.toString() : '')).trim();
  const assignerName = (assignerUser.name || '').toLowerCase().trim();

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

  // 1. Rule: Anyone can assign tasks to themselves (Super Admin, Manager, User)
  const isSelfAssignment =
    (assignerId && targetId && assignerId === targetId) ||
    (assignerName && cleanTarget === assignerName) ||
    (assignerUser.username && assignerUser.username.toLowerCase().trim() === cleanTarget) ||
    (assignerUser.email && assignerUser.email.toLowerCase().trim() === cleanTarget);

  if (isSelfAssignment) {
    return { valid: true, targetUser: targetUser || assignerUser };
  }

  // 2. Super Admin: Can assign tasks to everybody in the organization (all juniors below Super Admin)
  if (isSuperAdmin) {
    return { valid: true, targetUser };
  }

  // 3. Manager & User: Can assign tasks to ALL users who are under them in the hierarchy
  // Check if target is senior (Super Admin)
  if (targetRole === 'Super Admin') {
    return {
      valid: false,
      message: `${isManager ? 'Managers' : 'Users'} cannot assign tasks to seniors (Super Admin). Tasks can only be assigned to yourself or your junior subordinates.`,
      targetUser,
    };
  }

  // Check if regular user is trying to assign to a Manager
  if (!isManager && !isSuperAdmin && (targetRole === 'Manager' || targetRole === 'Executive' || targetRole === 'Administrator')) {
    return {
      valid: false,
      message: `Users cannot assign tasks to managers. Tasks can only be assigned to yourself or your junior subordinates.`,
      targetUser,
    };
  }

  const subordinateIds = getSubordinateUserIds(assignerUser, allUsers);
  const isJuniorInHierarchy = subordinateIds.has(targetId);

  if (!isJuniorInHierarchy) {
    if (isManager) {
      return {
        valid: false,
        message: `Hierarchy Constraint: Managers can only assign tasks to yourself or users under you in the hierarchy. ('${targetUser.name}' is not in your team hierarchy)`,
        targetUser,
      };
    } else {
      return {
        valid: false,
        message: `Hierarchy Constraint: You can only assign tasks to yourself or users who are under you in your team hierarchy. ('${targetUser.name}' is not in your subordinate hierarchy)`,
        targetUser,
      };
    }
  }

  return { valid: true, targetUser };
};

// @route   GET /api/tasks
// @desc    Get all tasks with optional search, type, status, and assignedTo filtering
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { search, taskType, status, assignedTo, myTasksOnly, teamOnly } = req.query;

    if (fallbackStore.isFallback) {
      let filtered = [...fallbackStore.tasks];

      const isSuperAdmin = req.user && req.user.role === 'Super Admin';
      const isManager = req.user && ['Super Admin', 'Manager', 'Executive', 'Administrator'].includes(req.user.role);
      const currentUserId = req.user._id ? req.user._id.toString() : '';
      const currentUserName = (req.user.name || '').toLowerCase();
      const currentUserUsername = (req.user.username || '').toLowerCase();

      // Find all direct and indirect subordinates for current user
      const subordinateIdsSet = getSubordinateUserIds(req.user, fallbackStore.users);
      const subordinateUsers = fallbackStore.users.filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));
      const subordinateNames = subordinateUsers.map((u) => (u.name || '').toLowerCase());
      const subordinateUsernames = subordinateUsers.map((u) => (u.username || '').toLowerCase());
      const subordinateIds = Array.from(subordinateIdsSet);
      
      if (!isSuperAdmin) {
        if (teamOnly === 'true') {
          // Team tasks: tasks assigned to user or any user reporting to this user
          const validAssignees = [currentUserName, currentUserUsername, ...subordinateNames, ...subordinateUsernames];
          filtered = filtered.filter((t) => {
            const tAssigned = (t.assignedTo || '').toLowerCase();
            const tUser = t.user ? t.user.toString() : '';
            return validAssignees.includes(tAssigned) || subordinateIds.includes(tUser);
          });
        } else if (myTasksOnly === 'true') {
          // Include own tasks AND tasks assigned by this user or tasks assigned to subordinates
          filtered = filtered.filter((t) => {
            const tAssigned = (t.assignedTo || '').toLowerCase();
            const tUser = t.user ? t.user.toString() : '';
            const tAssignedBy = (t.assignedBy || '').toLowerCase();
            const isAssignedToMe = tAssigned === currentUserName || tAssigned === currentUserUsername || tUser === currentUserId;
            const isAssignedToMySubordinate = subordinateNames.includes(tAssigned) || subordinateUsernames.includes(tAssigned) || subordinateIds.includes(tUser);
            const isAssignedByMe = tAssignedBy.includes(currentUserName) || (currentUserUsername && tAssignedBy.includes(currentUserUsername));
            return isAssignedToMe || isAssignedToMySubordinate || isAssignedByMe;
          });
        } else if (assignedTo && assignedTo !== 'all') {
          filtered = filtered.filter(
            (t) => t.assignedTo && t.assignedTo.toLowerCase() === assignedTo.toLowerCase()
          );
        } else {
          // Default user view: include own tasks, subordinates' tasks, and tasks assigned by user
          filtered = filtered.filter((t) => {
            const tAssigned = (t.assignedTo || '').toLowerCase();
            const tUser = t.user ? t.user.toString() : '';
            const tAssignedBy = (t.assignedBy || '').toLowerCase();
            const isAssignedToMe = tAssigned === currentUserName || tAssigned === currentUserUsername || tUser === currentUserId;
            const isAssignedToMySubordinate = subordinateNames.includes(tAssigned) || subordinateUsernames.includes(tAssigned) || subordinateIds.includes(tUser);
            const isAssignedByMe = tAssignedBy.includes(currentUserName) || (currentUserUsername && tAssignedBy.includes(currentUserUsername));
            return isAssignedToMe || isAssignedToMySubordinate || isAssignedByMe;
          });
        }
      } else if (assignedTo && assignedTo !== 'all') {
        filtered = filtered.filter(
          (t) => t.assignedTo && t.assignedTo.toLowerCase() === assignedTo.toLowerCase()
        );
      }

      // Search filter (description, remark, assignedTo, taskType, assignedBy)
      if (search && search.trim() !== '') {
        const query = search.trim().toLowerCase();
        filtered = filtered.filter(
          (t) =>
            t.description.toLowerCase().includes(query) ||
            (t.remark && t.remark.toLowerCase().includes(query)) ||
            (t.completionRemark && t.completionRemark.toLowerCase().includes(query)) ||
            t.taskType.toLowerCase().includes(query) ||
            (t.assignedTo && t.assignedTo.toLowerCase().includes(query)) ||
            (t.assignedBy && t.assignedBy.toLowerCase().includes(query))
        );
      }

      // Task Type filter
      if (taskType && taskType !== 'all') {
        filtered = filtered.filter((t) => t.taskType.toLowerCase() === taskType.toLowerCase());
      }

      // Status filter
      if (status && status !== 'all') {
        filtered = filtered.filter((t) => t.status === status);
      }

      // Sort by createdAt descending
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.json({
        success: true,
        count: filtered.length,
        tasks: filtered,
      });
    } else {
      const queryObj = {};

      const isSuperAdmin = req.user && req.user.role === 'Super Admin';
      const isManager = req.user && ['Super Admin', 'Manager', 'Executive', 'Administrator'].includes(req.user.role);

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

        if (teamOnly === 'true') {
          const names = [userName, userUsername, ...subordinateNames].filter(Boolean);
          queryObj.$or = [
            { assignedTo: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
            { user: { $in: [req.user._id, ...subordinateIds] } },
          ];
        } else if (myTasksOnly === 'true' || (!isManager && !assignedTo)) {
          const names = [userName, userUsername, ...subordinateNames].filter(Boolean);
          const orConditions = [
            { assignedTo: { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) } },
            { user: { $in: [req.user._id, ...subordinateIds] } },
            { assignedBy: new RegExp(escapeRegex(userName), 'i') },
          ];
          queryObj.$or = orConditions;
        } else if (assignedTo && assignedTo !== 'all') {
          queryObj.assignedTo = new RegExp('^' + escapeRegex(assignedTo.trim()) + '$', 'i');
        }
      } else if (assignedTo && assignedTo !== 'all') {
        queryObj.assignedTo = new RegExp('^' + escapeRegex(assignedTo.trim()) + '$', 'i');
      }

      if (search && search.trim() !== '') {
        const regex = new RegExp(escapeRegex(search.trim()), 'i');
        const searchConditions = [
          { description: regex },
          { remark: regex },
          { completionRemark: regex },
          { taskType: regex },
          { assignedTo: regex },
          { assignedBy: regex },
        ];

        if (queryObj.$or) {
          queryObj.$and = [{ $or: queryObj.$or }, { $or: searchConditions }];
          delete queryObj.$or;
        } else {
          queryObj.$or = searchConditions;
        }
      }

      if (taskType && taskType !== 'all') {
        queryObj.taskType = taskType.toLowerCase();
      }

      if (status && status !== 'all') {
        queryObj.status = status;
      }

      const tasks = await Task.find(queryObj).sort({ createdAt: -1 });

      return res.json({
        success: true,
        count: tasks.length,
        tasks,
      });
    }
  } catch (error) {
    console.error('Fetch tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tasks',
      error: error.message,
    });
  }
});

// @route   GET /api/tasks/stats
// @desc    Get dashboard metrics and task analytics
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const isSuperAdmin = req.user && req.user.role === 'Super Admin';
    const isManager = req.user && ['Super Admin', 'Manager', 'Executive', 'Administrator'].includes(req.user.role);
    const { myTasksOnly, teamOnly } = req.query;

    let allTasks = [];
    let allUsers = [];
    if (fallbackStore.isFallback) {
      allTasks = [...fallbackStore.tasks];
      allUsers = fallbackStore.users || [];
    } else {
      allTasks = await Task.find({});
      allUsers = await User.find({}).select('_id name username email role reportsTo reportsToName createdBy').lean();
    }

    if (!isSuperAdmin) {
      const userName = (req.user.name || '').toLowerCase().trim();
      const userUsername = (req.user.username || '').toLowerCase().trim();
      const userId = req.user._id ? req.user._id.toString() : (req.user.id ? req.user.id.toString() : '');

      const subordinateIdsSet = getSubordinateUserIds(req.user, allUsers);
      const subordinateUsers = allUsers.filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));
      const subordinateNames = subordinateUsers.map((u) => (u.name || '').toLowerCase().trim());
      const subordinateUsernames = subordinateUsers.map((u) => (u.username || '').toLowerCase().trim());
      const subordinateIds = Array.from(subordinateIdsSet);

      if (myTasksOnly === 'true') {
        allTasks = allTasks.filter((t) => {
          const tAssigned = (t.assignedTo || '').toLowerCase().trim();
          const tUser = t.user ? t.user.toString() : '';
          return tAssigned === userName || tAssigned === userUsername || tUser === userId;
        });
      } else {
        const validAssignees = [userName, userUsername, ...subordinateNames, ...subordinateUsernames].filter(Boolean);
        const validUserIds = [userId, ...subordinateIds].filter(Boolean);

        allTasks = allTasks.filter((t) => {
          const tAssigned = (t.assignedTo || '').toLowerCase().trim();
          const tUser = t.user ? t.user.toString() : '';
          const tAssignedBy = (t.assignedBy || '').toLowerCase().trim();
          const isAssignedToTeam = validAssignees.includes(tAssigned) || validUserIds.includes(tUser);
          const isAssignedByTeam = tAssignedBy.includes(userName) || (userUsername && tAssignedBy.includes(userUsername)) || subordinateNames.some(n => tAssignedBy.includes(n));
          return isAssignedToTeam || isAssignedByTeam;
        });
      }
    }

    const total = allTasks.length;
    const completed = allTasks.filter((t) => t.status === 'Completed').length;
    const inProgress = allTasks.filter((t) => t.status === 'In Progress').length;
    const toDo = allTasks.filter((t) => t.status === 'To Do').length;

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const byType = {
      'internet work': allTasks.filter((t) => t.taskType === 'internet work').length,
      'documentation': allTasks.filter((t) => t.taskType === 'documentation').length,
      'social media': allTasks.filter((t) => t.taskType === 'social media').length,
      'backend work': allTasks.filter((t) => t.taskType === 'backend work').length,
      'sells': allTasks.filter((t) => t.taskType === 'sells' || t.taskType === 'sales').length,
    };

    const now = new Date();
    const overdue = allTasks.filter(
      (t) => t.status !== 'Completed' && new Date(t.expectedDate) < now
    ).length;

    res.json({
      success: true,
      stats: {
        total,
        completed,
        inProgress,
        toDo,
        completionRate,
        overdue,
        byType,
      },
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve task statistics',
      error: error.message,
    });
  }
});

// @route   POST /api/tasks
// @desc    Add / assign a new task & notify the assigned user
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const {
      taskType,
      description,
      expectedDate,
      remark,
      status = 'To Do',
      priority = 'Medium',
      assignedTo,
      assignedBy,
    } = req.body;

    if (!taskType || !taskType.trim()) {
      return res.status(400).json({ success: false, message: 'Task type is required' });
    }

    const formattedType = taskType.trim().toLowerCase();
    if (!VALID_TASK_TYPES.includes(formattedType)) {
      return res.status(400).json({
        success: false,
        message: `Task type must be one of: ${VALID_TASK_TYPES.join(', ')}`,
      });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Task description is required' });
    }

    if (!expectedDate) {
      return res.status(400).json({ success: false, message: 'Expected completion date is required' });
    }

    const parsedDate = new Date(expectedDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid expected completion date format' });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const targetAssignedTo = (assignedTo && assignedTo.trim()) || req.user?.name || 'Current User';
    
    // Validate organizational hierarchy task assignment rules
    const hierarchyCheck = await validateHierarchyAssignment(req.user, targetAssignedTo);
    if (!hierarchyCheck.valid) {
      return res.status(400).json({
        success: false,
        message: hierarchyCheck.message,
      });
    }

    const managerAssignedBy =
      (assignedBy && assignedBy.trim()) || `${req.user?.name || 'Manager'} (${req.user?.role || 'Manager'})`;
    let targetUserId = hierarchyCheck.targetUser?._id || null;

    if (!targetUserId) {
      if (fallbackStore.isFallback) {
        const cleanTarget = targetAssignedTo.toLowerCase();
        const matchedUser = fallbackStore.users.find(
          (u) =>
            (u.name && u.name.trim().toLowerCase() === cleanTarget) ||
            (u.username && u.username.trim().toLowerCase() === cleanTarget) ||
            (u.email && u.email.trim().toLowerCase() === cleanTarget) ||
            (u._id && u._id.toString() === targetAssignedTo)
        );
        if (matchedUser) {
          targetUserId = matchedUser._id;
        } else if (req.user && req.user._id) {
          targetUserId = req.user._id;
        }
      } else {
        if (mongoose.Types.ObjectId.isValid(targetAssignedTo)) {
          const matchedById = await User.findById(targetAssignedTo);
          if (matchedById) targetUserId = matchedById._id;
        }
        if (!targetUserId) {
          const escaped = escapeRegex(targetAssignedTo);
          const matched = await User.findOne({
            $or: [
              { name: new RegExp('^' + escaped + '$', 'i') },
              { username: new RegExp('^' + escaped + '$', 'i') },
              { email: targetAssignedTo.toLowerCase() },
            ],
          });
          if (matched) {
            targetUserId = matched._id;
          } else if (req.user && req.user._id && mongoose.Types.ObjectId.isValid(req.user._id)) {
            targetUserId = req.user._id;
          }
        }
      }
    }

    const assignerIdStr = req.user?._id ? (req.user._id.toString ? req.user._id.toString() : req.user._id) : undefined;
    const newTaskData = {
      taskType: formattedType,
      description: description.trim(),
      expectedDate: parsedDate,
      remark: remark ? remark.trim() : '',
      completionRemark: '',
      status: status || 'To Do',
      priority: priority || 'Medium',
      assignedTo: targetAssignedTo,
      assignedBy: managerAssignedBy,
      assignedById: assignerIdStr,
      attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (targetUserId) {
      if (fallbackStore.isFallback) {
        newTaskData.user = targetUserId;
      } else if (mongoose.Types.ObjectId.isValid(targetUserId)) {
        newTaskData.user = targetUserId;
      }
    }

    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const generatedId = '64e8b2' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      const createdTask = { _id: generatedId, ...newTaskData };
      fallbackStore.tasks.unshift(createdTask);
      fallbackStore.saveToFile();

      // Dispatch task assignment notification to assigned user & socket
      await createUserAssignmentNotification(createdTask, targetAssignedTo, targetUserId, req.user, io);

      return res.status(201).json({
        success: true,
        message: 'Task added successfully',
        task: createdTask,
      });
    } else {
      const task = await Task.create(newTaskData);

      // Mirror to fallbackStore backup
      try {
        fallbackStore.tasks.unshift(task.toObject());
        fallbackStore.saveToFile();
      } catch (err) {
        console.warn('Local task backup notice:', err.message);
      }

      // Dispatch task assignment notification to assigned user & socket
      await createUserAssignmentNotification(task, targetAssignedTo, targetUserId, req.user, io);

      return res.status(201).json({
        success: true,
        message: 'Task added successfully',
        task,
      });
    }
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create task',
      error: error.message,
    });
  }
});

// @route   PUT /api/tasks/:id
// @desc    Edit and update full task details
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');
    const {
      taskType,
      description,
      expectedDate,
      remark,
      completionRemark,
      status,
      priority,
      assignedTo,
      assignedBy,
    } = req.body;

    if (taskType) {
      const formattedType = taskType.trim().toLowerCase();
      if (!VALID_TASK_TYPES.includes(formattedType)) {
        return res.status(400).json({
          success: false,
          message: `Task type must be one of: ${VALID_TASK_TYPES.join(', ')}`,
        });
      }
    }

    if (description !== undefined && !description.trim()) {
      return res.status(400).json({ success: false, message: 'Description cannot be empty' });
    }

    if (expectedDate) {
      const parsedDate = new Date(expectedDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expected completion date format' });
      }
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    let targetUserId = undefined;
    if (assignedTo && assignedTo.trim()) {
      const cleanAssigned = assignedTo.trim();

      // Validate hierarchy rules if assignee is changing
      const hierarchyCheck = await validateHierarchyAssignment(req.user, cleanAssigned);
      if (!hierarchyCheck.valid) {
        return res.status(400).json({
          success: false,
          message: hierarchyCheck.message,
        });
      }

      if (hierarchyCheck.targetUser && hierarchyCheck.targetUser._id) {
        targetUserId = hierarchyCheck.targetUser._id;
      } else if (fallbackStore.isFallback) {
        const cleanTarget = cleanAssigned.toLowerCase();
        const matchedUser = fallbackStore.users.find(
          (u) =>
            (u.name && u.name.trim().toLowerCase() === cleanTarget) ||
            (u.username && u.username.trim().toLowerCase() === cleanTarget) ||
            (u.email && u.email.trim().toLowerCase() === cleanTarget) ||
            (u._id && u._id.toString() === cleanAssigned)
        );
        if (matchedUser) {
          targetUserId = matchedUser._id;
        }
      } else {
        if (mongoose.Types.ObjectId.isValid(cleanAssigned)) {
          const matchedById = await User.findById(cleanAssigned);
          if (matchedById) targetUserId = matchedById._id;
        }
        if (!targetUserId) {
          const escaped = escapeRegex(cleanAssigned);
          const matchedUser = await User.findOne({
            $or: [
              { name: new RegExp('^' + escaped + '$', 'i') },
              { username: new RegExp('^' + escaped + '$', 'i') },
              { email: cleanAssigned.toLowerCase() },
            ],
          });
          if (matchedUser && mongoose.Types.ObjectId.isValid(matchedUser._id)) {
            targetUserId = matchedUser._id;
          }
        }
      }
    }

    if (fallbackStore.isFallback) {
      const taskIndex = fallbackStore.tasks.findIndex((t) => t._id.toString() === id.toString());
      if (taskIndex === -1) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const existing = fallbackStore.tasks[taskIndex];
      const wasCompleted = existing.status === 'Completed';
      const isNowCompleted = status === 'Completed';
      const previousAssignee = existing.assignedTo;

      const updated = {
        ...existing,
        taskType: taskType ? taskType.trim().toLowerCase() : existing.taskType,
        description: description !== undefined ? description.trim() : existing.description,
        expectedDate: expectedDate ? new Date(expectedDate) : existing.expectedDate,
        remark: remark !== undefined ? remark.trim() : existing.remark,
        completionRemark:
          completionRemark !== undefined ? completionRemark.trim() : existing.completionRemark || '',
        status: status || existing.status,
        priority: priority || existing.priority,
        assignedTo: assignedTo !== undefined ? assignedTo.trim() : existing.assignedTo,
        assignedBy: assignedBy !== undefined ? assignedBy.trim() : existing.assignedBy || 'Manager (Admin)',
        attachments: req.body.attachments !== undefined ? req.body.attachments : (existing.attachments || []),
        user: targetUserId || existing.user,
        completedAt: isNowCompleted ? existing.completedAt || new Date() : null,
        updatedAt: new Date(),
      };

      fallbackStore.tasks[taskIndex] = updated;
      fallbackStore.saveToFile();

      // Trigger manager notification if newly completed
      if (isNowCompleted && !wasCompleted) {
        await createManagerNotification(updated, req.user, completionRemark || updated.remark, io);
      }

      // If reassigned, notify the new assigned user
      if (assignedTo && assignedTo.trim() !== previousAssignee) {
        await createUserAssignmentNotification(updated, updated.assignedTo, targetUserId, req.user, io);
      }

      if (io) {
        io.emit('tasks:updated', { task: updated, action: 'update' });
        io.emit('stats:updated');
      }

      return res.json({
        success: true,
        message: 'Task updated successfully',
        task: updated,
      });
    } else {
      let task = await Task.findById(id);
      if (!task) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const wasCompleted = task.status === 'Completed';
      const isNowCompleted = status === 'Completed';
      const previousAssignee = task.assignedTo;

      if (taskType) task.taskType = taskType.trim().toLowerCase();
      if (description !== undefined) task.description = description.trim();
      if (expectedDate) task.expectedDate = new Date(expectedDate);
      if (remark !== undefined) task.remark = remark.trim();
      if (completionRemark !== undefined) task.completionRemark = completionRemark.trim();
      if (status) task.status = status;
      if (priority) task.priority = priority;
      if (req.body.attachments !== undefined) task.attachments = req.body.attachments;
      if (assignedTo !== undefined) {
        task.assignedTo = assignedTo.trim();
        if (targetUserId) task.user = targetUserId;
      }
      if (assignedBy !== undefined) task.assignedBy = assignedBy.trim();
      if (isNowCompleted && !wasCompleted) {
        task.completedAt = new Date();
      } else if (status && status !== 'Completed') {
        task.completedAt = null;
      }
      task.updatedAt = new Date();

      await task.save();

      // Mirror to fallbackStore backup
      try {
        const localIdx = fallbackStore.tasks.findIndex(t => t._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.tasks[localIdx] = task.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local task backup update notice:', err.message);
      }

      // Trigger manager notification if newly completed
      if (isNowCompleted && !wasCompleted) {
        await createManagerNotification(task, req.user, completionRemark || task.remark, io);
      }

      // If reassigned, notify the new assigned user
      if (assignedTo && assignedTo.trim() !== previousAssignee) {
        await createUserAssignmentNotification(task, task.assignedTo, targetUserId, req.user, io);
      }

      if (io) {
        io.emit('tasks:updated', { task, action: 'update' });
        io.emit('stats:updated');
      }

      return res.json({
        success: true,
        message: 'Task updated successfully',
        task,
      });
    }
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update task',
      error: error.message,
    });
  }
});

// @route   PATCH /api/tasks/:id/status
// @desc    Quick update status of a task with optional completion remark
// @access  Private
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');
    const { status, completionRemark, remark } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const finalRemark = (completionRemark || remark || '').trim();

    if (fallbackStore.isFallback) {
      const taskIndex = fallbackStore.tasks.findIndex((t) => t._id.toString() === id.toString());
      if (taskIndex === -1) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const existing = fallbackStore.tasks[taskIndex];
      const wasCompleted = existing.status === 'Completed';

      existing.status = status;
      if (finalRemark) {
        existing.completionRemark = finalRemark;
      }
      if (status === 'Completed') {
        existing.completedAt = new Date();
      } else {
        existing.completedAt = null;
      }
      existing.updatedAt = new Date();
      fallbackStore.saveToFile();

      if (status === 'Completed' && !wasCompleted) {
        await createManagerNotification(existing, req.user, finalRemark, io);
      } else if (io) {
        io.emit('tasks:updated', { task: existing, action: 'status' });
        io.emit('stats:updated');
      }

      return res.json({
        success: true,
        message: `Task status updated to ${status}`,
        task: existing,
      });
    } else {
      const updateData = {
        status,
        updatedAt: new Date(),
      };
      if (finalRemark) {
        updateData.completionRemark = finalRemark;
      }
      if (status === 'Completed') {
        updateData.completedAt = new Date();
      } else {
        updateData.completedAt = null;
      }

      const task = await Task.findById(id);
      if (!task) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const wasCompleted = task.status === 'Completed';
      task.status = status;
      if (finalRemark) task.completionRemark = finalRemark;
      if (status === 'Completed') {
        task.completedAt = new Date();
      } else {
        task.completedAt = null;
      }
      task.updatedAt = new Date();

      await task.save();

      // Mirror to fallbackStore
      try {
        const localIdx = fallbackStore.tasks.findIndex(t => t._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.tasks[localIdx] = task.toObject();
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local task backup update notice:', err.message);
      }

      if (status === 'Completed' && !wasCompleted) {
        await createManagerNotification(task, req.user, finalRemark, io);
      } else if (io) {
        io.emit('tasks:updated', { task, action: 'status' });
        io.emit('stats:updated');
      }

      return res.json({
        success: true,
        message: `Task status updated to ${status}`,
        task,
      });
    }
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update task status',
      error: error.message,
    });
  }
});

// @route   DELETE /api/tasks/:id
// @desc    Delete a task
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const taskIndex = fallbackStore.tasks.findIndex((t) => t._id.toString() === id.toString());
      if (taskIndex === -1) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const deleted = fallbackStore.tasks.splice(taskIndex, 1)[0];
      fallbackStore.saveToFile();

      if (io) {
        io.emit('task:deleted', { id });
        io.emit('tasks:updated', { id, action: 'delete' });
        io.emit('stats:updated');
      }

      return res.json({
        success: true,
        message: 'Task deleted successfully',
        task: deleted,
      });
    } else {
      const task = await Task.findByIdAndDelete(id);

      if (!task) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      try {
        const localIdx = fallbackStore.tasks.findIndex(t => t._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.tasks.splice(localIdx, 1);
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local task backup delete notice:', err.message);
      }

      if (io) {
        io.emit('task:deleted', { id });
        io.emit('tasks:updated', { id, action: 'delete' });
        io.emit('stats:updated');
      }

      return res.json({
        success: true,
        message: 'Task deleted successfully',
        task,
      });
    }
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete task',
      error: error.message,
    });
  }
});

module.exports = router;
