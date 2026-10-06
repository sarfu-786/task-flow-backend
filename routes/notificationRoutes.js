const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

const escapeRegex = (str) => (str ? str.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '');

// Helper to determine if a notification object belongs to / is visible to a specific user in fallbackStore
function isNotificationForUser(n, user) {
  if (!n || !user) return false;
  const isSuperAdmin = user.role === 'Super Admin';
  const isManager = ['Manager', 'Executive', 'Administrator', 'Super Admin'].includes(user.role);
  const userName = (user.name || '').toLowerCase().trim();
  const userUsername = (user.username || '').toLowerCase().trim();
  const userId = user._id ? user._id.toString() : '';

  const rUser = n.recipientUser ? n.recipientUser.toString() : '';
  const rName = (n.recipientName || '').toLowerCase().trim();
  const isDirectRecipient =
    (rUser && rUser === userId) ||
    (rName && (rName === userName || rName === userUsername || userName.includes(rName) || rName.includes(userName)));

  // Direct Assigner Rule: Task completion notifications MUST only go to the assigner
  if (n.type === 'task_completed') {
    return isDirectRecipient;
  }

  // Direct recipient always sees notifications targeted to them (e.g. newly assigned leads, tasks, complaints)
  if (isDirectRecipient) {
    return true;
  }

  if (isSuperAdmin) {
    return n.forRole === 'Super Admin' || n.forRole === 'Manager' || n.forRole === 'All' || !n.forRole;
  } else if (isManager) {
    return n.forRole === 'Manager' || n.forRole === 'All' || !n.forRole;
  } else {
    return n.forRole === 'User' || n.forRole === 'All';
  }
}

// Helper to build MongoDB query for notifications visible to a specific user
function buildUserNotifFilter(user) {
  const isSuperAdmin = user && user.role === 'Super Admin';
  const isManager = user && ['Manager', 'Executive', 'Administrator', 'Super Admin'].includes(user.role);
  const regexName = escapeRegex(user?.name || '');
  const regexUsername = escapeRegex(user?.username || '');
  const userId = user?._id ? user._id.toString() : '';

  const directConditions = [
    ...(userId ? [{ recipientUser: user._id }] : []),
    ...(regexName ? [{ recipientName: new RegExp(`^${regexName}$`, 'i') }] : []),
    ...(regexUsername ? [{ recipientName: new RegExp(`^${regexUsername}$`, 'i') }] : []),
  ];

  if (isSuperAdmin) {
    return {
      $or: [
        ...directConditions,
        { forRole: { $in: ['Super Admin', 'Manager', 'All'] }, type: { $ne: 'task_completed' } },
      ],
    };
  } else if (isManager) {
    return {
      $or: [
        ...directConditions,
        { forRole: { $in: ['Manager', 'All'] }, type: { $ne: 'task_completed' } },
      ],
    };
  } else {
    return {
      $or: [
        ...directConditions,
        { forRole: { $in: ['User', 'All'] }, type: { $ne: 'task_completed' } },
      ],
    };
  }
}

// @route   GET /api/notifications
// @desc    Get notifications for logged-in user (Super Admin, Manager, Coordinator, or User)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    if (fallbackStore.isFallback) {
      let list = (fallbackStore.notifications || []).filter((n) => isNotificationForUser(n, req.user));
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const unreadCount = list.filter((n) => !n.isRead).length;

      return res.json({
        success: true,
        count: list.length,
        unreadCount,
        notifications: list,
      });
    } else {
      const filter = buildUserNotifFilter(req.user);
      const notifications = await Notification.find(filter).sort({ createdAt: -1 });
      const unreadCount = notifications.filter((n) => !n.isRead).length;

      return res.json({
        success: true,
        count: notifications.length,
        unreadCount,
        notifications,
      });
    }
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message,
    });
  }
});

// @route   PATCH /api/notifications/:id/read
// @desc    Mark a single notification as read
// @access  Private
router.patch('/:id/read', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');
    let updatedNotif = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.notifications || []).findIndex(
        (n) => n._id && n._id.toString() === id.toString()
      );
      if (idx !== -1) {
        fallbackStore.notifications[idx].isRead = true;
        fallbackStore.saveToFile();
        updatedNotif = fallbackStore.notifications[idx];
      }
    } else {
      updatedNotif = await Notification.findByIdAndUpdate(
        id,
        { isRead: true },
        { new: true }
      );
      if (Array.isArray(fallbackStore.notifications)) {
        const idx = fallbackStore.notifications.findIndex(
          (n) => n._id && n._id.toString() === id.toString()
        );
        if (idx !== -1) {
          fallbackStore.notifications[idx].isRead = true;
          fallbackStore.saveToFile();
        }
      }
    }

    if (io) {
      io.emit('notification:updated', { id, isRead: true });
    }

    return res.json({
      success: true,
      message: 'Notification marked as read',
      notification: updatedNotif,
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification',
      error: error.message,
    });
  }
});

// @route   PATCH /api/notifications/mark-all-read
// @desc    Mark all notifications for the current user as read
// @access  Private
router.patch('/mark-all-read', protect, async (req, res) => {
  try {
    const io = req.app.get('io');
    const userId = req.user?._id ? req.user._id.toString() : '';

    if (fallbackStore.isFallback) {
      if (Array.isArray(fallbackStore.notifications)) {
        fallbackStore.notifications.forEach((n) => {
          if (isNotificationForUser(n, req.user)) {
            n.isRead = true;
          }
        });
        fallbackStore.saveToFile();
      }
    } else {
      const filter = buildUserNotifFilter(req.user);
      await Notification.updateMany({ ...filter, isRead: false }, { isRead: true });

      if (Array.isArray(fallbackStore.notifications)) {
        fallbackStore.notifications.forEach((n) => {
          if (isNotificationForUser(n, req.user)) {
            n.isRead = true;
          }
        });
        fallbackStore.saveToFile();
      }
    }

    if (io) {
      io.emit('notification:updated', { allRead: true, userId });
    }

    return res.json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notifications',
      error: error.message,
    });
  }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete a single notification
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');
    let deleted = null;

    if (fallbackStore.isFallback) {
      const idx = (fallbackStore.notifications || []).findIndex(
        (n) => n._id && n._id.toString() === id.toString()
      );
      if (idx !== -1) {
        deleted = fallbackStore.notifications.splice(idx, 1)[0];
        fallbackStore.saveToFile();
      }
    } else {
      deleted = await Notification.findByIdAndDelete(id);
      if (Array.isArray(fallbackStore.notifications)) {
        const idx = fallbackStore.notifications.findIndex(
          (n) => n._id && n._id.toString() === id.toString()
        );
        if (idx !== -1) {
          fallbackStore.notifications.splice(idx, 1);
          fallbackStore.saveToFile();
        }
      }
    }

    if (io) {
      io.emit('notification:updated', { deletedId: id });
    }

    return res.json({
      success: true,
      message: 'Notification deleted',
      notification: deleted,
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message,
    });
  }
});

// @route   DELETE /api/notifications
// @desc    Clear all notifications for the current user (permanently persists across refresh)
// @access  Private
router.delete('/', protect, async (req, res) => {
  try {
    const io = req.app.get('io');
    const userId = req.user?._id ? req.user._id.toString() : '';

    if (fallbackStore.isFallback) {
      fallbackStore.notifications = (fallbackStore.notifications || []).filter(
        (n) => !isNotificationForUser(n, req.user)
      );
      fallbackStore.saveToFile();
    } else {
      const filter = buildUserNotifFilter(req.user);
      await Notification.deleteMany(filter);

      if (Array.isArray(fallbackStore.notifications)) {
        fallbackStore.notifications = fallbackStore.notifications.filter(
          (n) => !isNotificationForUser(n, req.user)
        );
        fallbackStore.saveToFile();
      }
    }

    if (io) {
      io.emit('notification:updated', { cleared: true, userId });
    }

    return res.json({
      success: true,
      message: 'Notifications cleared',
    });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear notifications',
      error: error.message,
    });
  }
});

module.exports = router;
