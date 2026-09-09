const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

const VALID_TASK_TYPES = ['internet work', 'documentation', 'social media', 'backend work'];
const VALID_STATUSES = ['To Do', 'In Progress', 'Completed'];

// Safe regex character escaper
const escapeRegex = (str) => (str ? str.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '');

// Helper to create Manager Notification when a task is completed or remarked
const createManagerNotification = async (task, user, completionRemark = '', io = null) => {
  try {
    const userName = user?.name || task.assignedTo || 'Team Member';
    const userAvatar = user?.avatar || '';
    const taskDesc = task.description || 'Assigned Task';
    const shortDesc = taskDesc.length > 55 ? taskDesc.substring(0, 52) + '...' : taskDesc;
    const remarkText = completionRemark || task.completionRemark || task.remark || 'Marked as completed';

    const safeUserId = user && user._id && mongoose.Types.ObjectId.isValid(user._id)
      ? user._id
      : (task.user && mongoose.Types.ObjectId.isValid(task.user) ? task.user : undefined);

    const safeTaskId = task && task._id && mongoose.Types.ObjectId.isValid(task._id)
      ? task._id
      : undefined;

    const notifData = {
      user: safeUserId,
      userName: userName,
      userAvatar: userAvatar,
      taskId: safeTaskId,
      taskDescription: taskDesc,
      taskType: task.taskType || 'internet work',
      type: 'task_completed',
      title: `Task Completed: ${userName}`,
      message: `${userName} has completed "${shortDesc}"`,
      remark: remarkText,
      isRead: false,
      forRole: 'Manager',
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

    // Instant Real-Time Socket.io dispatch to Managers
    if (io) {
      const payload = {
        notification: createdNotif,
        task: task,
        type: 'task_completed',
        title: `Task Completed: ${userName}`,
        message: `${userName} completed "${shortDesc}"`,
        remark: remarkText,
      };
      io.to('role:Manager').emit('notification:new', payload);
      io.to('role:Manager').emit('task:completed', { task, notification: createdNotif });
      io.emit('tasks:updated', { task, action: 'completed' });
      io.emit('stats:updated');
    }
  } catch (err) {
    console.error('[Manager Notification Helper Error]', err.message);
  }
};

// Helper to create User Notification when manager assigns a task
const createUserAssignmentNotification = async (task, targetAssignedTo, targetUserId, managerUser, io = null) => {
  try {
    const assignedBy = managerUser ? `${managerUser.name} (${managerUser.role || 'Manager'})` : 'Manager';
    const taskDesc = task.description || 'Assigned Task';
    const shortDesc = taskDesc.length > 55 ? taskDesc.substring(0, 52) + '...' : taskDesc;
    const instructions = task.remark ? `Instructions: ${task.remark}` : 'Please review the task details and start working on it.';

    const safeManagerId = managerUser && managerUser._id && mongoose.Types.ObjectId.isValid(managerUser._id)
      ? managerUser._id
      : undefined;

    const safeRecipientId = targetUserId && mongoose.Types.ObjectId.isValid(targetUserId)
      ? targetUserId
      : undefined;

    const safeTaskId = task && task._id && mongoose.Types.ObjectId.isValid(task._id)
      ? task._id
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
      io.to('role:Manager').emit('notification:new', payload);
      io.emit('tasks:updated', { task, action: 'created' });
      io.emit('stats:updated');
    }
  } catch (err) {
    console.error('[User Assignment Notification Helper Error]', err.message);
  }
};

/**
 * Validates organizational hierarchy task assignment rules:
 * 1. Super Admin can assign tasks to any junior user or manager across the organization.
 * 2. Managers can ONLY assign tasks to their junior team members (direct/indirect subordinates).
 * 3. Nobody can assign tasks to seniors (e.g. Manager cannot assign to Super Admin).
 * 4. Nobody can assign tasks to themselves.
 * 5. Regular users cannot assign tasks to others.
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

  if (fallbackStore.isFallback) {
    targetUser = fallbackStore.users.find(
      (u) =>
        (u.name && u.name.trim().toLowerCase() === cleanTarget) ||
        (u.username && u.username.trim().toLowerCase() === cleanTarget) ||
        (u.email && u.email.trim().toLowerCase() === cleanTarget) ||
        (u._id && u._id.toString() === targetAssignedTo.toString().trim())
    );
  } else {
    if (mongoose.Types.ObjectId.isValid(targetAssignedTo)) {
      targetUser = await User.findById(targetAssignedTo).lean();
    }
    if (!targetUser) {
      const escaped = escapeRegex(targetAssignedTo.toString().trim());
      targetUser = await User.findOne({
        $or: [
          { name: new RegExp('^' + escaped + '$', 'i') },
          { username: new RegExp('^' + escaped + '$', 'i') },
          { email: cleanTarget },
        ],
      }).lean();
    }
  }

  if (!targetUser) {
    return { valid: true, targetUser: null };
  }

  const targetId = (targetUser._id ? targetUser._id.toString() : (targetUser.id ? targetUser.id.toString() : '')).trim();
  const targetRole = targetUser.role || 'User';

  // 1. Rule: Nobody can assign tasks to themselves ("not himself")
  if (assignerId && targetId && assignerId === targetId) {
    return {
      valid: false,
      message: 'Hierarchy Constraint: You cannot assign a task to yourself. Tasks can only be assigned to junior team members.',
      targetUser,
    };
  }

  // 2. Super Admin: Can assign tasks to everybody in the organization (all juniors below Super Admin)
  if (isSuperAdmin) {
    if (targetRole === 'Super Admin' && targetId !== assignerId) {
      return {
        valid: false,
        message: 'Hierarchy Constraint: Super Admin cannot assign tasks to peer Super Admins. Tasks can only be assigned to junior users and managers.',
        targetUser,
      };
    }
    return { valid: true, targetUser };
  }

  // 3. Manager: Can ONLY assign tasks to junior team members reporting to them, NOT seniors (Super Admin)
  if (isManager) {
    if (targetRole === 'Super Admin') {
      return {
        valid: false,
        message: 'Hierarchy Constraint: Managers cannot assign tasks to seniors (Super Admin). Tasks can only be assigned to your junior subordinates.',
        targetUser,
      };
    }

    const targetReportsTo = targetUser.reportsTo ? (targetUser.reportsTo._id || targetUser.reportsTo).toString() : '';
    const targetReportsToName = (targetUser.reportsToName || '').toLowerCase().trim();

    const isDirectJunior =
      (targetReportsTo && targetReportsTo === assignerId) ||
      (targetReportsToName && (targetReportsToName.includes(assignerName) || assignerName.includes(targetReportsToName)));

    if (!isDirectJunior) {
      return {
        valid: false,
        message: `Hierarchy Constraint: Managers can only assign tasks to junior team members who report directly to them. ('${targetUser.name}' does not report to you)`,
        targetUser,
      };
    }
    return { valid: true, targetUser };
  }

  // 4. Regular users cannot assign tasks to others
  return {
    valid: false,
    message: 'Hierarchy Constraint: Users cannot assign tasks to seniors or other team members. Tasks are assigned by your reporting manager or Super Admin.',
    targetUser,
  };
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
      
      if (!isManager || myTasksOnly === 'true') {
        const userName = req.user.name ? req.user.name.toLowerCase() : '';
        const userUsername = req.user.username ? req.user.username.toLowerCase() : '';
        const userId = req.user._id ? req.user._id.toString() : '';

        filtered = filtered.filter((t) => {
          const tAssigned = (t.assignedTo || '').toLowerCase();
          const tUser = t.user ? t.user.toString() : '';
          return tAssigned === userName || tAssigned === userUsername || tUser === userId;
        });
      } else if (teamOnly === 'true' && !isSuperAdmin) {
        // Manager's team tasks: tasks assigned to the manager or any user reporting to this manager
        const managerId = req.user._id ? req.user._id.toString() : '';
        const managerName = (req.user.name || '').toLowerCase();
        const subordinateNames = fallbackStore.users
          .filter(u => 
            (u.reportsTo && u.reportsTo.toString() === managerId) ||
            (u.reportsToName && u.reportsToName.toLowerCase().includes(managerName))
          )
          .map(u => (u.name || '').toLowerCase());
        
        const validAssignees = [managerName, (req.user.username || '').toLowerCase(), ...subordinateNames];
        filtered = filtered.filter((t) => {
          const tAssigned = (t.assignedTo || '').toLowerCase();
          return validAssignees.includes(tAssigned);
        });
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

      if (!isManager || myTasksOnly === 'true') {
        const orConditions = [];
        if (req.user.name) {
          orConditions.push({ assignedTo: new RegExp('^' + escapeRegex(req.user.name) + '$', 'i') });
        }
        if (req.user.username) {
          orConditions.push({ assignedTo: new RegExp('^' + escapeRegex(req.user.username) + '$', 'i') });
        }
        if (req.user.email) {
          orConditions.push({ assignedTo: new RegExp('^' + escapeRegex(req.user.email) + '$', 'i') });
        }
        if (req.user._id && mongoose.Types.ObjectId.isValid(req.user._id)) {
          orConditions.push({ user: req.user._id });
        }
        queryObj.$or = orConditions.length > 0 ? orConditions : [{ assignedTo: 'none' }];
      } else if (teamOnly === 'true' && !isSuperAdmin) {
        const managerId = req.user._id ? req.user._id.toString() : '';
        const managerName = req.user.name || '';
        const subordinates = await User.find({
          $or: [
            { reportsTo: req.user._id },
            { reportsToName: new RegExp(escapeRegex(managerName), 'i') },
          ]
        }).select('name username');
        const names = [managerName, req.user.username, ...subordinates.map(s => s.name), ...subordinates.map(s => s.username)].filter(Boolean);
        queryObj.assignedTo = { $in: names.map(n => new RegExp('^' + escapeRegex(n) + '$', 'i')) };
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
    if (fallbackStore.isFallback) {
      allTasks = [...fallbackStore.tasks];
    } else {
      allTasks = await Task.find({});
    }

    if (!isManager || myTasksOnly === 'true') {
      const userName = req.user.name ? req.user.name.toLowerCase() : '';
      const userUsername = req.user.username ? req.user.username.toLowerCase() : '';
      const userId = req.user._id ? req.user._id.toString() : '';

      allTasks = allTasks.filter((t) => {
        const tAssigned = (t.assignedTo || '').toLowerCase();
        const tUser = t.user ? t.user.toString() : '';
        return tAssigned === userName || tAssigned === userUsername || tUser === userId;
      });
    } else if (teamOnly === 'true' && !isSuperAdmin) {
      const managerId = req.user._id ? req.user._id.toString() : '';
      const managerName = (req.user.name || '').toLowerCase();
      
      let subordinateNames = [];
      if (fallbackStore.isFallback) {
        subordinateNames = fallbackStore.users
          .filter(u => 
            (u.reportsTo && u.reportsTo.toString() === managerId) ||
            (u.reportsToName && u.reportsToName.toLowerCase().includes(managerName))
          )
          .map(u => (u.name || '').toLowerCase());
      } else {
        const subs = await User.find({
          $or: [
            { reportsTo: req.user._id },
            { reportsToName: new RegExp(escapeRegex(req.user.name || ''), 'i') },
          ]
        }).select('name username');
        subordinateNames = subs.map(s => (s.name || '').toLowerCase());
      }

      const validAssignees = [managerName, (req.user.username || '').toLowerCase(), ...subordinateNames];
      allTasks = allTasks.filter((t) => {
        const tAssigned = (t.assignedTo || '').toLowerCase();
        return validAssignees.includes(tAssigned);
      });
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
