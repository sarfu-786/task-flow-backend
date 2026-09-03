const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect, JWT_SECRET } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

const Notification = require('../models/Notification');

// Generate JWT with comprehensive user claims for resilient session verification
const generateToken = (userOrId) => {
  if (typeof userOrId === 'object' && userOrId !== null) {
    const userId = userOrId._id ? userOrId._id.toString() : (userOrId.id ? userOrId.id.toString() : '');
    return jwt.sign(
      {
        id: userId,
        email: (userOrId.email || '').toLowerCase().trim(),
        username: (userOrId.username || '').toLowerCase().trim(),
        role: userOrId.role || 'User',
        name: userOrId.name || '',
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
  }
  return jwt.sign({ id: userOrId ? userOrId.toString() : '' }, JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @route   POST /api/auth/register
// @desc    Register a new user account
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, username, role, department, avatar } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your full name',
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a password',
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters long',
      });
    }

    // Public registration registers regular employees with 'Pending' approval status
    const cleanRole = 'User';
    const cleanDept = department && department.trim() ? department.trim() : 'Internet Work';
    const cleanAvatar = avatar && avatar.trim() ? avatar.trim() : '';
    const cleanStatus = 'Pending';

    // Determine or generate a unique clean username
    let cleanUsername = username && username.trim()
      ? username.trim().toLowerCase()
      : cleanEmail.split('@')[0].replace(/[^a-z0-9._-]/g, '') || name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    if (fallbackStore.isFallback) {
      // Check existing in fallback store
      const existingUser = fallbackStore.users.find(
        (u) => u.email.toLowerCase() === cleanEmail || u.username.toLowerCase() === cleanUsername
      );

      if (existingUser) {
        if (existingUser.email.toLowerCase() === cleanEmail) {
          return res.status(400).json({
            success: false,
            message: 'An account with this email address already exists. Please log in instead.',
          });
        } else {
          cleanUsername = `${cleanUsername}${Math.floor(100 + Math.random() * 900)}`;
        }
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const generatedId = '64e8a1' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10);

      const newUser = {
        _id: generatedId,
        name: name.trim(),
        email: cleanEmail,
        username: cleanUsername,
        password: hashedPassword,
        role: cleanRole,
        department: cleanDept,
        avatar: cleanAvatar,
        status: cleanStatus,
        createdAt: new Date(),
      };

      fallbackStore.users.unshift(newUser);

      // Create notification for Manager in fallback store
      fallbackStore.notifications.unshift({
        _id: 'notif_' + Date.now(),
        userName: newUser.name,
        userAvatar: newUser.avatar,
        taskDescription: `Registration Request: ${newUser.name} (${newUser.email})`,
        taskType: 'general',
        type: 'user_registered',
        title: 'New User Registration Awaiting Approval',
        message: `${newUser.name} (${newUser.email}) from department "${newUser.department}" has registered and is awaiting your approval.`,
        forRole: 'Manager',
        isRead: false,
        createdAt: new Date(),
      });

      fallbackStore.saveToFile();

      return res.status(201).json({
        success: true,
        message: 'Account registration submitted! Your account is pending manager approval before you can log in.',
        approvalStatus: 'Pending',
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          username: newUser.username,
          role: newUser.role,
          department: newUser.department,
          avatar: newUser.avatar,
          status: newUser.status,
          createdAt: newUser.createdAt,
        },
      });
    } else {
      // Check existing in MongoDB
      const existingUser = await User.findOne({
        $or: [{ email: cleanEmail }, { username: cleanUsername }],
      });

      if (existingUser) {
        if (existingUser.email === cleanEmail) {
          return res.status(400).json({
            success: false,
            message: 'An account with this email address already exists. Please log in instead.',
          });
        } else {
          cleanUsername = `${cleanUsername}${Math.floor(100 + Math.random() * 900)}`;
        }
      }

      const user = await User.create({
        name: name.trim(),
        email: cleanEmail,
        username: cleanUsername,
        password: password,
        role: cleanRole,
        department: cleanDept,
        avatar: cleanAvatar,
        status: cleanStatus,
      });

      // Create notification for Manager
      try {
        await Notification.create({
          userName: user.name,
          userAvatar: user.avatar || '',
          taskDescription: `Registration Request: ${user.name} (${user.email})`,
          taskType: 'general',
          type: 'user_registered',
          title: 'New User Registration Awaiting Approval',
          message: `${user.name} (${user.email}) from department "${user.department}" has registered and is awaiting your approval.`,
          forRole: 'Manager',
          isRead: false,
        });
      } catch (notifErr) {
        console.warn('Notification create warning:', notifErr.message);
      }

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
          status: user.status,
          createdAt: user.createdAt,
        };
        const existIdx = fallbackStore.users.findIndex((u) => u.email === cleanEmail);
        if (existIdx >= 0) {
          fallbackStore.users[existIdx] = localCopy;
        } else {
          fallbackStore.users.unshift(localCopy);
        }
        fallbackStore.saveToFile();
      } catch (err) {
        console.warn('Local backup write notice:', err.message);
      }

      return res.status(201).json({
        success: true,
        message: 'Account registration submitted! Your account is pending manager approval before you can log in.',
        approvalStatus: 'Pending',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          department: user.department,
          avatar: user.avatar,
          status: user.status,
          createdAt: user.createdAt,
        },
      });
    }
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message,
    });
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const inputIdentifier = req.body.usernameOrEmail || req.body.email || req.body.username;
    const { password } = req.body;

    // Validation
    if (!inputIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both username/email and password',
      });
    }

    const identifier = inputIdentifier.trim().toLowerCase();

    if (fallbackStore.isFallback) {
      const user = fallbackStore.users.find(
        (u) => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email/username or password. Please check your credentials.',
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email/username or password. Please check your credentials.',
        });
      }

      // Check approval status (Managers always approved, default is Approved)
      const userStatus = user.status || 'Approved';
      if (user.role !== 'Manager' && userStatus === 'Pending') {
        return res.status(403).json({
          success: false,
          message: "You can't login because the manager has not approved your registration yet. Please wait for manager approval.",
          approvalStatus: 'Pending',
        });
      }

      if (user.role !== 'Manager' && userStatus === 'Rejected') {
        return res.status(403).json({
          success: false,
          message: 'Your registration request has been rejected by the manager. Please contact your manager.',
          approvalStatus: 'Rejected',
        });
      }

      const token = generateToken(user);

      return res.json({
        success: true,
        token,
        user: {
          id: user._id ? user._id.toString() : user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          department: user.department,
          avatar: user.avatar,
          status: userStatus,
          createdAt: user.createdAt,
        },
      });
    } else {
      // Find by email or username
      const user = await User.findOne({
        $or: [{ email: identifier }, { username: identifier }],
      }).select('+password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email/username or password. Please check your credentials.',
        });
      }

      const isMatch = await user.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email/username or password. Please check your credentials.',
        });
      }

      // Check approval status (Managers always approved, default is Approved)
      const userStatus = user.status || 'Approved';
      if (user.role !== 'Manager' && userStatus === 'Pending') {
        return res.status(403).json({
          success: false,
          message: "You can't login because the manager has not approved your registration yet. Please wait for manager approval.",
          approvalStatus: 'Pending',
        });
      }

      if (user.role !== 'Manager' && userStatus === 'Rejected') {
        return res.status(403).json({
          success: false,
          message: 'Your registration request has been rejected by the manager. Please contact your manager.',
          approvalStatus: 'Rejected',
        });
      }

      const token = generateToken(user);

      return res.json({
        success: true,
        token,
        user: {
          id: user._id ? user._id.toString() : user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          department: user.department,
          avatar: user.avatar,
          status: userStatus,
          createdAt: user.createdAt,
        },
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login authentication',
      error: error.message,
    });
  }
});

// In-memory OTP storage: key = identifier (lowercase email/username), value = { otp, expiresAt, userId }
const passwordResetOtpStore = new Map();

// @route   POST /api/auth/forgot-password
// @desc    Generate password reset OTP and return it for popup display
// @access  Public
router.post('/forgot-password', async (req, res) => {
  try {
    const { usernameOrEmail } = req.body;
    if (!usernameOrEmail || !usernameOrEmail.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your username or registered email address',
      });
    }

    const identifier = usernameOrEmail.trim().toLowerCase();
    let foundUser = null;

    if (fallbackStore.isFallback) {
      foundUser = fallbackStore.users.find(
        (u) => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier
      );
    } else {
      foundUser = await User.findOne({
        $or: [{ email: identifier }, { username: identifier }],
      });
    }

    if (!foundUser) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this username or email address',
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    passwordResetOtpStore.set(identifier, {
      otp,
      expiresAt,
      userId: foundUser._id ? foundUser._id.toString() : foundUser.id,
      email: foundUser.email,
    });

    return res.json({
      success: true,
      message: 'Password reset OTP generated successfully!',
      otp: otp, // Returned for simulated popup on frontend
      email: foundUser.email,
      name: foundUser.name,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while generating OTP',
      error: error.message,
    });
  }
});

// @route   POST /api/auth/verify-otp
// @desc    Verify the submitted reset OTP
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { usernameOrEmail, otp } = req.body;
    if (!usernameOrEmail || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Username/email and OTP are required',
      });
    }

    const identifier = usernameOrEmail.trim().toLowerCase();
    const record = passwordResetOtpStore.get(identifier);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'No OTP request found for this account. Please request a new OTP.',
      });
    }

    if (Date.now() > record.expiresAt) {
      passwordResetOtpStore.delete(identifier);
      return res.status(400).json({
        success: false,
        message: 'The OTP has expired. Please request a new one.',
      });
    }

    if (record.otp !== otp.toString().trim()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please check the OTP popup and try again.',
      });
    }

    return res.json({
      success: true,
      message: 'OTP verified successfully! You can now create your new password.',
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during OTP verification',
      error: error.message,
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset user password after OTP verification
// @access  Public
router.post('/reset-password', async (req, res) => {
  try {
    const { usernameOrEmail, otp, newPassword } = req.body;
    if (!usernameOrEmail || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Username/email, OTP, and new password are required',
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters long',
      });
    }

    const identifier = usernameOrEmail.trim().toLowerCase();
    const record = passwordResetOtpStore.get(identifier);

    if (!record || record.otp !== otp.toString().trim() || Date.now() > record.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP session. Please request a new OTP.',
      });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    if (fallbackStore.isFallback) {
      const uIndex = fallbackStore.users.findIndex(
        (u) => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier
      );
      if (uIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      fallbackStore.users[uIndex].password = hashedPassword;
      fallbackStore.saveToFile();
    } else {
      const user = await User.findOne({
        $or: [{ email: identifier }, { username: identifier }],
      });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      user.password = newPassword; // Mongoose User schema pre('save') hashes it
      await user.save();

      // Mirror to fallbackStore
      try {
        const localIdx = fallbackStore.users.findIndex(
          (u) => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier
        );
        if (localIdx >= 0) {
          fallbackStore.users[localIdx].password = hashedPassword;
          fallbackStore.saveToFile();
        }
      } catch (err) {
        console.warn('Backup write error:', err.message);
      }
    }

    // Clear used OTP
    passwordResetOtpStore.delete(identifier);

    return res.json({
      success: true,
      message: 'Password has been reset successfully! You can now sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while resetting password',
      error: error.message,
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get logged in user profile
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile data',
      error: error.message,
    });
  }
});

module.exports = router;
