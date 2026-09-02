const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// @route   GET /api/users
// @desc    Get all users list with search filter
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { search, role, department, status } = req.query;

    if (fallbackStore.isFallback) {
      let usersList = fallbackStore.users.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role,
        department: u.department,
        avatar: u.avatar,
        status: u.status || 'Approved',
        createdAt: u.createdAt,
      }));

      // Filter by status: If not specified, exclude Rejected and Pending users from active employee lists
      if (status && status !== 'all') {
        usersList = usersList.filter((u) => u.status === status);
      } else if (!status) {
        usersList = usersList.filter((u) => u.status !== 'Rejected' && u.status !== 'Pending');
      }

      if (search && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        usersList = usersList.filter(
          (u) =>
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            u.username.toLowerCase().includes(q) ||
            (u.department && u.department.toLowerCase().includes(q))
        );
      }

      if (role && role !== 'all') {
        usersList = usersList.filter((u) => u.role === role);
      }

      if (department && department !== 'all') {
        usersList = usersList.filter((u) => u.department === department);
      }

      // Sort by createdAt descending
      usersList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.json({
        success: true,
        count: usersList.length,
        users: usersList,
      });
    } else {
      const queryObj = {};

      if (status && status !== 'all') {
        queryObj.status = status;
      } else if (!status) {
        // Exclude Rejected and Pending users from active employee list
        queryObj.status = { $nin: ['Rejected', 'Pending'] };
      }

      if (search && search.trim() !== '') {
        const regex = new RegExp(search.trim(), 'i');
        queryObj.$or = [
          { name: regex },
          { email: regex },
          { username: regex },
          { department: regex },
        ];
      }

      if (role && role !== 'all') {
        queryObj.role = role;
      }

      if (department && department !== 'all') {
        queryObj.department = department;
      }

      const users = await User.find(queryObj).select('-password').sort({ createdAt: -1 });

      return res.json({
        success: true,
        count: users.length,
        users,
      });
    }
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user list',
      error: error.message,
    });
  }
});

// @route   POST /api/users
// @desc    Add a new user
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { name, email, username, password, role = 'User', department = 'Engineering' } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }

    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().toLowerCase();
    const userPassword = password && password.trim() ? password.trim() : 'user123';

    if (fallbackStore.isFallback) {
      const existingUser = fallbackStore.users.find(
        (u) => u.email.toLowerCase() === cleanEmail || u.username.toLowerCase() === cleanUsername
      );

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'A user with this email or username already exists',
        });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userPassword, salt);
      const generatedId = '64e8a1' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);

      const newUser = {
        _id: generatedId,
        name: name.trim(),
        email: cleanEmail,
        username: cleanUsername,
        password: hashedPassword,
        role: role || 'User',
        department: department ? department.trim() : 'Operations',
        avatar: req.body.avatar || '',
        createdAt: new Date(),
      };

      fallbackStore.users.unshift(newUser);
      fallbackStore.saveToFile();

      const returnedUser = { ...newUser };
      delete returnedUser.password;

      return res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: returnedUser,
      });
    } else {
      const existingUser = await User.findOne({
        $or: [{ email: cleanEmail }, { username: cleanUsername }],
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'A user with this email or username already exists',
        });
      }

      const user = await User.create({
        name: name.trim(),
        email: cleanEmail,
        username: cleanUsername,
        password: userPassword,
        role: role || 'User',
        department: department ? department.trim() : 'Operations',
        avatar: req.body.avatar || '',
      });

      // Mirror to fallbackStore backup
      try {
        const localCopy = {
          _id: user._id.toString(),
          name: user.name,
          email: user.email,
          username: user.username,
          password: user.password,
          role: user.role,
          department: user.department,
          avatar: user.avatar || '',
          createdAt: user.createdAt,
        };
        fallbackStore.users.unshift(localCopy);
        fallbackStore.saveToFile();
      } catch (err) {
        console.warn('Local backup write notice:', err.message);
      }

      const returnedUser = user.toObject();
      delete returnedUser.password;

      return res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: returnedUser,
      });
    }
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message,
    });
  }
});

// @route   PUT /api/users/:id
// @desc    Edit and update user record
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, username, role, department, avatar, password } = req.body;

    if (fallbackStore.isFallback) {
      const userIndex = fallbackStore.users.findIndex((u) => u._id.toString() === id.toString());
      if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const existing = fallbackStore.users[userIndex];
      let newHashedPassword = existing.password;
      if (password && password.trim().length >= 4) {
        const salt = await bcrypt.genSalt(10);
        newHashedPassword = await bcrypt.hash(password.trim(), salt);
      }

      const updated = {
        ...existing,
        name: name !== undefined ? name.trim() : existing.name,
        email: email !== undefined ? email.trim().toLowerCase() : existing.email,
        username: username !== undefined ? username.trim().toLowerCase() : existing.username,
        role: role || existing.role,
        department: department !== undefined ? department.trim() : existing.department,
        avatar: avatar !== undefined ? avatar : existing.avatar,
        password: newHashedPassword,
      };

      fallbackStore.users[userIndex] = updated;
      fallbackStore.saveToFile();

      const returnedUser = { ...updated };
      delete returnedUser.password;

      return res.json({
        success: true,
        message: 'User details updated successfully',
        user: returnedUser,
      });
    } else {
      let user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (name !== undefined) user.name = name.trim();
      if (email !== undefined) user.email = email.trim().toLowerCase();
      if (username !== undefined) user.username = username.trim().toLowerCase();
      if (role) user.role = role;
      if (department !== undefined) user.department = department.trim();
      if (avatar !== undefined) user.avatar = avatar;
      if (password && password.trim().length >= 4) {
        user.password = password.trim();
      }

      await user.save();

      // Mirror to local store
      try {
        const localIdx = fallbackStore.users.findIndex(u => u._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.users[localIdx] = {
            ...fallbackStore.users[localIdx],
            name: user.name,
            email: user.email,
            username: user.username,
            role: user.role,
            department: user.department,
            avatar: user.avatar,
          };
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local backup update notice:', err.message);
      }

      const returnedUser = user.toObject();
      delete returnedUser.password;

      return res.json({
        success: true,
        message: 'User details updated successfully',
        user: returnedUser,
      });
    }
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user details',
      error: error.message,
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    Remove / delete a user record
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    if (fallbackStore.isFallback) {
      const userIndex = fallbackStore.users.findIndex((u) => u._id.toString() === id.toString());
      if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const deleted = fallbackStore.users.splice(userIndex, 1)[0];
      fallbackStore.saveToFile();
      const returnedUser = { ...deleted };
      delete returnedUser.password;

      return res.json({
        success: true,
        message: 'User removed successfully',
        user: returnedUser,
      });
    } else {
      const user = await User.findByIdAndDelete(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      try {
        const localIdx = fallbackStore.users.findIndex(u => u._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.users.splice(localIdx, 1);
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Local backup delete notice:', err.message);
      }

      return res.json({
        success: true,
        message: 'User removed successfully',
        user,
      });
    }
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove user',
      error: error.message,
    });
  }
});

// @route   GET /api/users/approvals
// @desc    Get all user registrations with approval status
// @access  Private (Manager only)
router.get('/approvals', protect, async (req, res) => {
  try {
    const { status, search } = req.query;

    let usersList = [];
    if (fallbackStore.isFallback) {
      usersList = fallbackStore.users.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role,
        department: u.department,
        avatar: u.avatar,
        status: u.status || 'Approved',
        createdAt: u.createdAt,
      }));
    } else {
      const rawUsers = await User.find({}).select('-password').sort({ createdAt: -1 });
      usersList = rawUsers.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role,
        department: u.department,
        avatar: u.avatar,
        status: u.status || 'Approved',
        createdAt: u.createdAt,
      }));
    }

    // Compute counts
    const pendingCount = usersList.filter((u) => u.status === 'Pending').length;
    const approvedCount = usersList.filter((u) => u.status === 'Approved').length;
    const rejectedCount = usersList.filter((u) => u.status === 'Rejected').length;
    const totalCount = usersList.length;

    // Apply status filter
    if (status && status !== 'all') {
      usersList = usersList.filter((u) => u.status === status);
    }

    // Apply search filter
    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      usersList = usersList.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          (u.department && u.department.toLowerCase().includes(q))
      );
    }

    return res.json({
      success: true,
      counts: {
        total: totalCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
      users: usersList,
    });
  } catch (error) {
    console.error('Fetch approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user approvals',
      error: error.message,
    });
  }
});

// @route   PUT /api/users/:id/approval
// @desc    Approve or reject a user registration
// @access  Private (Manager only)
router.put('/:id/approval', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, department, role } = req.body;

    if (!status || !['Approved', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status (Approved, Rejected, or Pending) is required',
      });
    }

    if (fallbackStore.isFallback) {
      const uIndex = fallbackStore.users.findIndex((u) => u._id.toString() === id.toString());
      if (uIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      fallbackStore.users[uIndex].status = status;
      if (department) fallbackStore.users[uIndex].department = department;
      if (role) fallbackStore.users[uIndex].role = role;
      fallbackStore.saveToFile();

      const returnedUser = { ...fallbackStore.users[uIndex] };
      delete returnedUser.password;

      return res.json({
        success: true,
        message: `User registration has been ${status.toLowerCase()} successfully!`,
        user: returnedUser,
      });
    } else {
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      user.status = status;
      if (department) user.department = department;
      if (role) user.role = role;
      await user.save();

      // Mirror to fallbackStore
      try {
        const localIdx = fallbackStore.users.findIndex((u) => u._id.toString() === id.toString());
        if (localIdx >= 0) {
          fallbackStore.users[localIdx].status = status;
          if (department) fallbackStore.users[localIdx].department = department;
          if (role) fallbackStore.users[localIdx].role = role;
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Backup write notice:', err.message);
      }

      const returnedUser = user.toObject();
      delete returnedUser.password;

      return res.json({
        success: true,
        message: `User registration has been ${status.toLowerCase()} successfully!`,
        user: returnedUser,
      });
    }
  } catch (error) {
    console.error('Update approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user approval status',
      error: error.message,
    });
  }
});

module.exports = router;
