const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect, JWT_SECRET } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @route   POST /api/auth/register
// @desc    Register a new user account
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, username, role, department } = req.body;

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

    // Determine clean role: 'Manager' or 'User'
    const allowedRoles = ['Manager', 'Executive', 'Administrator', 'User'];
    let cleanRole = 'User';
    if (role && (allowedRoles.includes(role) || role.toLowerCase() === 'manager')) {
      cleanRole = role.toLowerCase() === 'manager' ? 'Manager' : role;
    }

    // Determine clean department
    const cleanDept = department && department.trim()
      ? department.trim()
      : (cleanRole === 'Manager' ? 'Management' : 'Operations');

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
          // If username collided, adjust username by appending random number
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
        avatar: '',
        createdAt: new Date(),
      };

      fallbackStore.users.unshift(newUser);
      fallbackStore.saveToFile();

      return res.status(201).json({
        success: true,
        message: `Account created successfully as ${cleanRole}! You can now log in to the ${cleanRole === 'Manager' ? 'Manager Portal' : 'User Portal'}.`,
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          username: newUser.username,
          role: newUser.role,
          department: newUser.department,
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
        avatar: '',
      });

      return res.status(201).json({
        success: true,
        message: `Account created successfully as ${cleanRole}! You can now log in to the ${cleanRole === 'Manager' ? 'Manager Portal' : 'User Portal'}.`,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          department: user.department,
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
    const { usernameOrEmail, password } = req.body;

    // Validation
    if (!usernameOrEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both username/email and password',
      });
    }

    const identifier = usernameOrEmail.trim().toLowerCase();

    if (fallbackStore.isFallback) {
      const user = fallbackStore.users.find(
        (u) => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. User not found.',
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Incorrect password.',
        });
      }

      const token = generateToken(user._id);

      return res.json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          department: user.department,
          avatar: user.avatar,
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
          message: 'Invalid credentials. User not found.',
        });
      }

      const isMatch = await user.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Incorrect password.',
        });
      }

      const token = generateToken(user._id);

      return res.json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          department: user.department,
          avatar: user.avatar,
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
