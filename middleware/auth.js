const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { fallbackStore } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'taskmanagement_secret_key_2026_jwt_token';

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      if (fallbackStore.isFallback) {
        const user = fallbackStore.users.find(u => u._id.toString() === decoded.id.toString());
        if (!user) {
          return res.status(401).json({ success: false, message: 'User not found' });
        }
        req.user = {
          _id: user._id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          department: user.department,
          avatar: user.avatar
        };
      } else {
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
          return res.status(401).json({ success: false, message: 'User not found' });
        }
        req.user = user;
      }

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
