const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { fallbackStore } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'taskmanagement_secret_key_2026_jwt_token_super_secure_enterprise';

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      let user = null;

      // 1. Try finding in MongoDB if connected
      if (mongoose.connection && mongoose.connection.readyState === 1 && !fallbackStore.isFallback) {
        try {
          if (mongoose.Types.ObjectId.isValid(decoded.id)) {
            user = await User.findById(decoded.id).select('-password');
          }
          if (!user && decoded.email) {
            user = await User.findOne({ email: decoded.email.toLowerCase() }).select('-password');
          }
          if (!user && decoded.username) {
            user = await User.findOne({ username: decoded.username.toLowerCase() }).select('-password');
          }
        } catch (dbErr) {
          console.warn('[Auth Middleware] MongoDB find warning:', dbErr.message);
        }
      }

      // 2. If not found in MongoDB or during fallback, check fallbackStore
      if (!user) {
        const localUser = fallbackStore.users.find(
          (u) =>
            u._id.toString() === decoded.id.toString() ||
            (decoded.email && (u.email || '').toLowerCase() === decoded.email.toLowerCase()) ||
            (decoded.username && (u.username || '').toLowerCase() === decoded.username.toLowerCase())
        );

        if (localUser) {
          user = {
            _id: localUser._id,
            name: localUser.name,
            email: localUser.email,
            username: localUser.username,
            role: localUser.role,
            department: localUser.department,
            avatar: localUser.avatar || '',
            status: localUser.status || 'Approved',
          };
        }
      }

      if (!user) {
        return res.status(401).json({ success: false, message: 'User account not found or access revoked' });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('Token verification error:', error.message);
      return res.status(401).json({ success: false, message: 'Not authorized, token failed or expired' });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no authorization token provided' });
  }
};

module.exports = { protect, JWT_SECRET };

