const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

const VALID_TASK_TYPES = ['internet work', 'documentation', 'social media', 'backend work'];
const VALID_STATUSES = ['To Do', 'In Progress', 'Completed'];

// Helper to create Manager Notification when a task is completed or remarked
const createManagerNotification = async (task, user, completionRemark = '') => {
  try {
    const userName = user?.name || task.assignedTo || 'Team Member';
    const userAvatar = user?.avatar || '';
    const taskDesc = task.description || 'Assigned Task';
    const shortDesc = taskDesc.length > 55 ? taskDesc.substring(0, 52) + '...' : taskDesc;
    const remarkText = completionRemark || task.completionRemark || task.remark || 'Marked as completed';

    const notifData = {
      user: user?._id || task.user,
      userName: userName,
      userAvatar: userAvatar,
      taskId: task._id,
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

    if (fallbackStore.isFallback) {
      if (!fallbackStore.notifications) {
        fallbackStore.notifications = [];
      }
      const notifId = '64e8c3' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      fallbackStore.notifications.unshift({ _id: notifId, ...notifData });
      fallbackStore.saveToFile();
    } else {
      await Notification.create(notifData);
    }
  } catch (err) {
    console.error('[Manager Notification Helper Error]', err.message);
  }
};

// Helper to create User Notification when manager assigns a task
const createUserAssignmentNotification = async (task, targetAssignedTo, targetUserId, managerUser) => {
  try {
    const assignedBy = managerUser ? `${managerUser.name} (${managerUser.role || 'Manager'})` : 'Manager';
    const taskDesc = task.description || 'Assigned Task';
    const shortDesc = taskDesc.length > 55 ? taskDesc.substring(0, 52) + '...' : taskDesc;
    const instructions = task.remark ? `Instructions: ${task.remark}` : 'Please review the task details and start working on it.';

    const notifData = {
      user: managerUser?._id,
      recipientUser: targetUserId,
      recipientName: targetAssignedTo,
      userName: managerUser?.name || 'Manager',
      userAvatar: managerUser?.avatar || '',
      assignedBy: assignedBy,
      taskId: task._id,
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

    if (fallbackStore.isFallback) {
      if (!fallbackStore.notifications) {
        fallbackStore.notifications = [];
      }
      const notifId = '64e8c3' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      fallbackStore.notifications.unshift({ _id: notifId, ...notifData });
      fallbackStore.saveToFile();
    } else {
      await Notification.create(notifData);
    }
  } catch (err) {
    console.error('[User Assignment Notification Helper Error]', err.message);
  }
};

// @route   GET /api/tasks
// @desc    Get all tasks with optional search, type, status, and assignedTo filtering
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { search, taskType, status, assignedTo, myTasksOnly } = req.query;

    if (fallbackStore.isFallback) {
      let filtered = [...fallbackStore.tasks];

      const isManager = req.user && ['Manager', 'Executive', 'Administrator'].includes(req.user.role);
      
      if (!isManager || myTasksOnly === 'true') {
        const userName = req.user.name ? req.user.name.toLowerCase() : '';
        const userUsername = req.user.username ? req.user.username.toLowerCase() : '';
        const userId = req.user._id ? req.user._id.toString() : '';

        filtered = filtered.filter((t) => {
          const tAssigned = (t.assignedTo || '').toLowerCase();
          const tUser = t.user ? t.user.toString() : '';
          return tAssigned === userName || tAssigned === userUsername || tUser === userId;
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

      const isManager = req.user && ['Manager', 'Executive', 'Administrator'].includes(req.user.role);

      if (!isManager || myTasksOnly === 'true') {
        queryObj.$or = [
          { assignedTo: new RegExp('^' + req.user.name + '$', 'i') },
          { assignedTo: new RegExp('^' + req.user.username + '$', 'i') },
          { user: req.user._id },
        ];
      } else if (assignedTo && assignedTo !== 'all') {
        queryObj.assignedTo = new RegExp('^' + assignedTo.trim() + '$', 'i');
      }

      if (search && search.trim() !== '') {
        const regex = new RegExp(search.trim(), 'i');
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
    const isManager = req.user && ['Manager', 'Executive', 'Administrator'].includes(req.user.role);
    const { myTasksOnly } = req.query;

    let allTasks = [];
    if (fallbackStore.isFallback) {
      allTasks = fallbackStore.tasks;
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

    const targetAssignedTo = (assignedTo && assignedTo.trim()) || req.user.name || 'Current User';
    const managerAssignedBy =
      (assignedBy && assignedBy.trim()) || `${req.user.name || 'Manager'} (${req.user.role || 'Manager'})`;
    let targetUserId = req.user._id;

    if (fallbackStore.isFallback) {
      const matchedUser = fallbackStore.users.find(
        (u) =>
          (u.name && u.name.trim().toLowerCase() === targetAssignedTo.toLowerCase()) ||
          (u.username && u.username.trim().toLowerCase() === targetAssignedTo.toLowerCase())
      );
      if (matchedUser) {
        targetUserId = matchedUser._id;
      }
    } else {
      const matchedUser = await User.findOne({
        $or: [
          { name: new RegExp('^' + targetAssignedTo + '$', 'i') },
          { username: new RegExp('^' + targetAssignedTo + '$', 'i') },
        ],
      });
      if (matchedUser) {
        targetUserId = matchedUser._id;
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
      user: targetUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (fallbackStore.isFallback) {
      const generatedId = '64e8b2' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);
      const createdTask = { _id: generatedId, ...newTaskData };
      fallbackStore.tasks.unshift(createdTask);
      fallbackStore.saveToFile();

      // Dispatch task assignment notification to assigned user
      await createUserAssignmentNotification(createdTask, targetAssignedTo, targetUserId, req.user);

      return res.status(201).json({
        success: true,
        message: 'Task added successfully',
        task: createdTask,
      });
    } else {
      const task = await Task.create(newTaskData);

      // Dispatch task assignment notification to assigned user
      await createUserAssignmentNotification(task, targetAssignedTo, targetUserId, req.user);

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
      if (fallbackStore.isFallback) {
        const matchedUser = fallbackStore.users.find(
          (u) =>
            (u.name && u.name.trim().toLowerCase() === assignedTo.trim().toLowerCase()) ||
            (u.username && u.username.trim().toLowerCase() === assignedTo.trim().toLowerCase())
        );
        if (matchedUser) {
          targetUserId = matchedUser._id;
        }
      } else {
        const matchedUser = await User.findOne({
          $or: [
            { name: new RegExp('^' + assignedTo.trim() + '$', 'i') },
            { username: new RegExp('^' + assignedTo.trim() + '$', 'i') },
          ],
        });
        if (matchedUser) {
          targetUserId = matchedUser._id;
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
        await createManagerNotification(updated, req.user, completionRemark || updated.remark);
      }

      // If reassigned, notify the new assigned user
      if (assignedTo && assignedTo.trim() !== previousAssignee) {
        await createUserAssignmentNotification(updated, updated.assignedTo, targetUserId, req.user);
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

      // Trigger manager notification if newly completed
      if (isNowCompleted && !wasCompleted) {
        await createManagerNotification(task, req.user, completionRemark || task.remark);
      }

      // If reassigned, notify the new assigned user
      if (assignedTo && assignedTo.trim() !== previousAssignee) {
        await createUserAssignmentNotification(task, task.assignedTo, targetUserId, req.user);
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
        await createManagerNotification(existing, req.user, finalRemark);
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

      if (status === 'Completed' && !wasCompleted) {
        await createManagerNotification(task, req.user, finalRemark);
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

    if (fallbackStore.isFallback) {
      const taskIndex = fallbackStore.tasks.findIndex((t) => t._id.toString() === id.toString());
      if (taskIndex === -1) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const deleted = fallbackStore.tasks.splice(taskIndex, 1)[0];
      fallbackStore.saveToFile();

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
