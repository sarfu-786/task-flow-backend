const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// @route   GET /api/notifications
// @desc    Get notifications for logged-in user (Manager or User)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const isManager = req.user && ['Manager', 'Executive', 'Administrator'].includes(req.user.role);
    const userName = (req.user?.name || '').toLowerCase().trim();
    const userUsername = (req.user?.username || '').toLowerCase().trim();
    const userId = req.user?._id ? req.user._id.toString() : '';

    if (fallbackStore.isFallback) {
      let list = [...(fallbackStore.notifications || [])];

      if (isManager) {
        // Manager sees completion alerts and manager messages
        list = list.filter((n) => n.forRole === 'Manager' || n.forRole === 'All');
      } else {
        // Regular user sees assignment notifications sent to them
        list = list.filter((n) => {
          if (n.forRole === 'Manager') return false;
          const rName = (n.recipientName || '').toLowerCase().trim();
          const rUser = n.recipientUser ? n.recipientUser.toString() : '';

          return (
            (rUser && rUser === userId) ||
            (rName && (rName === userName || rName === userUsername || userName.includes(rName) || rName.includes(userName))) ||
            n.forRole === 'All'
          );
        });
      }

      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const unreadCount = list.filter((n) => !n.isRead).length;

      return res.json({
        success: true,
        count: list.length,
        unreadCount,
        notifications: list,
      });
    } else {
      let filter = {};
      if (isManager) {
        filter = { forRole: { $in: ['Manager', 'All'] } };
      } else {
        filter = {
          forRole: { $ne: 'Manager' },
          $or: [
            { recipientUser: req.user._id },
            { recipientName: new RegExp(req.user.name, 'i') },
            { recipientName: new RegExp(req.user.username, 'i') },
            { forRole: 'All' },
          ],
        };
      }

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

    if (fallbackStore.isFallback) {
      const idx = fallbackStore.notifications.findIndex(
        (n) => n._id.toString() === id.toString()
      );
      if (idx === -1) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      fallbackStore.notifications[idx].isRead = true;
      fallbackStore.saveToFile();

      if (io) {
        io.emit('notification:updated', { id, isRead: true });
      }

      return res.json({
        success: true,
        message: 'Notification marked as read',
        notification: fallbackStore.notifications[idx],
      });
    } else {
      const notification = await Notification.findByIdAndUpdate(
        id,
        { isRead: true },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      if (io) {
        io.emit('notification:updated', { id, isRead: true });
      }

      return res.json({
        success: true,
        message: 'Notification marked as read',
        notification,
      });
    }
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
// @desc    Mark all notifications as read
// @access  Private
router.patch('/mark-all-read', protect, async (req, res) => {
  try {
    const isManager = req.user && ['Manager', 'Executive', 'Administrator'].includes(req.user.role);
    const userName = (req.user?.name || '').toLowerCase().trim();
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      if (fallbackStore.notifications) {
        fallbackStore.notifications.forEach((n) => {
          if (isManager && (n.forRole === 'Manager' || n.forRole === 'All')) {
            n.isRead = true;
          } else if (!isManager && (n.forRole === 'User' || (n.recipientName || '').toLowerCase() === userName)) {
            n.isRead = true;
          }
        });
        fallbackStore.saveToFile();
      }

      if (io) {
        io.emit('notification:updated', { allRead: true });
      }

      return res.json({
        success: true,
        message: 'All notifications marked as read',
      });
    } else {
      if (isManager) {
        await Notification.updateMany({ forRole: { $in: ['Manager', 'All'] }, isRead: false }, { isRead: true });
      } else {
        await Notification.updateMany(
          {
            $or: [
              { recipientName: new RegExp(req.user.name, 'i') },
              { recipientUser: req.user._id },
              { forRole: 'User' },
            ],
            isRead: false,
          },
          { isRead: true }
        );
      }

      if (io) {
        io.emit('notification:updated', { allRead: true });
      }

      return res.json({
        success: true,
        message: 'All notifications marked as read',
      });
    }
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
// @desc    Delete a notification
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      const idx = fallbackStore.notifications.findIndex(
        (n) => n._id.toString() === id.toString()
      );
      if (idx === -1) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      const deleted = fallbackStore.notifications.splice(idx, 1)[0];
      fallbackStore.saveToFile();

      if (io) {
        io.emit('notification:updated', { deletedId: id });
      }

      return res.json({
        success: true,
        message: 'Notification deleted',
        notification: deleted,
      });
    } else {
      const notification = await Notification.findByIdAndDelete(id);
      if (!notification) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      if (io) {
        io.emit('notification:updated', { deletedId: id });
      }

      return res.json({
        success: true,
        message: 'Notification deleted',
        notification,
      });
    }
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
// @desc    Clear all notifications
// @access  Private
router.delete('/', protect, async (req, res) => {
  try {
    const isManager = req.user && ['Manager', 'Executive', 'Administrator'].includes(req.user.role);
    const io = req.app.get('io');

    if (fallbackStore.isFallback) {
      if (isManager) {
        fallbackStore.notifications = fallbackStore.notifications.filter(
          (n) => n.forRole !== 'Manager' && n.forRole !== 'All'
        );
      } else {
        const userName = (req.user?.name || '').toLowerCase().trim();
        const userUsername = (req.user?.username || '').toLowerCase().trim();
        const userId = req.user?._id ? req.user._id.toString() : '';

        fallbackStore.notifications = fallbackStore.notifications.filter((n) => {
          if (n.forRole === 'Manager') return true; // keep manager notifications
          const rName = (n.recipientName || '').toLowerCase().trim();
          const rUser = n.recipientUser ? n.recipientUser.toString() : '';

          const isForThisUser =
            rName === userName ||
            rName === userUsername ||
            (rUser && rUser === userId) ||
            (rName && userName && (userName.includes(rName) || rName.includes(userName))) ||
            n.forRole === 'User';

          return !isForThisUser;
        });
      }
      fallbackStore.saveToFile();

      if (io) {
        io.emit('notification:updated', { cleared: true });
      }

      return res.json({
        success: true,
        message: 'Notifications cleared',
      });
    } else {
      if (isManager) {
        await Notification.deleteMany({ forRole: { $in: ['Manager', 'All'] } });
      } else {
        await Notification.deleteMany({
          $or: [
            { recipientName: new RegExp(req.user.name, 'i') },
            { recipientName: new RegExp(req.user.username, 'i') },
            { recipientUser: req.user._id },
            { forRole: 'User' },
          ],
        });
      }

      if (io) {
        io.emit('notification:updated', { cleared: true });
      }

      return res.json({
        success: true,
        message: 'Notifications cleared',
      });
    }
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
