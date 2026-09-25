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
      if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).json({ success: false, message: 'Not authorized, invalid token format' });
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      let user = null;

      const cleanEmail = (decoded.email || '').toLowerCase().trim();
      const cleanUsername = (decoded.username || '').toLowerCase().trim();
      const decodedId = decoded.id ? decoded.id.toString() : '';

      // 1. Try finding in MongoDB if connected
      if (mongoose.connection && mongoose.connection.readyState === 1 && !fallbackStore.isFallback) {
        try {
          if (decodedId && mongoose.Types.ObjectId.isValid(decodedId)) {
            user = await User.findById(decodedId).select('-password');
          }
          if (!user && cleanEmail) {
            user = await User.findOne({ email: cleanEmail }).select('-password');
          }
          if (!user && cleanUsername) {
            user = await User.findOne({ username: cleanUsername }).select('-password');
          }
        } catch (dbErr) {
          console.warn('[Auth Middleware] MongoDB find warning:', dbErr.message);
        }
      }

      // 2. If not found in MongoDB or during fallback, check fallbackStore
      if (!user && fallbackStore.users && fallbackStore.users.length > 0) {
        const localUser = fallbackStore.users.find(
          (u) =>
            (decodedId && u._id && u._id.toString() === decodedId) ||
            (cleanEmail && (u.email || '').toLowerCase().trim() === cleanEmail) ||
            (cleanUsername && (u.username || '').toLowerCase().trim() === cleanUsername)
        );

        if (localUser) {
          const userRoles = Array.isArray(localUser.roles) && localUser.roles.length > 0
            ? localUser.roles
            : [localUser.role || 'User'];

          user = {
            _id: localUser._id,
            name: localUser.name,
            email: localUser.email,
            username: localUser.username,
            role: localUser.role || userRoles[0] || 'User',
            roles: userRoles,
            department: localUser.department || 'Internet Work',
            avatar: localUser.avatar || '',
            status: localUser.status || 'Approved',
            reportsTo: localUser.reportsTo || null,
            reportsToName: localUser.reportsToName || '',
          };
        }
      }

      // 3. Resilient session fallback from verified JWT token
      if (!user && (cleanEmail || cleanUsername || decodedId)) {
        const tokenRoles = Array.isArray(decoded.roles) && decoded.roles.length > 0
          ? decoded.roles
          : [decoded.role || 'User'];

        user = {
          _id: decodedId || '64e8a1' + Math.random().toString(16).substring(2, 10) + '00000000'.substring(0, 10),
          name: decoded.name || decoded.username || (cleanEmail ? cleanEmail.split('@')[0] : 'User'),
          email: decoded.email || '',
          username: decoded.username || (cleanEmail ? cleanEmail.split('@')[0] : 'user'),
          role: decoded.role || tokenRoles[0] || 'User',
          roles: tokenRoles,
          department: 'Internet Work',
          avatar: '',
          status: 'Approved',
          reportsTo: decoded.reportsTo || null,
          reportsToName: decoded.reportsToName || '',
        };
      }

      if (!user) {
        return res.status(401).json({ success: false, message: 'User account not found or access revoked' });
      }

      // Ensure roles array is always populated
      if (!user.roles || !Array.isArray(user.roles) || user.roles.length === 0) {
        user.roles = [user.role || 'User'];
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

const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const userRoles = Array.isArray(req.user.roles) && req.user.roles.length > 0
      ? req.user.roles
      : [req.user.role || 'User'];

    const hasPermission =
      userRoles.includes('Super Admin') ||
      userRoles.some((r) => allowedRoles.includes(r));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]. Current roles: [${userRoles.join(', ')}]`,
      });
    }
    next();
  };
};

module.exports = { protect, checkRole, JWT_SECRET };
