const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const VALID_ROLES = [
  'Super Admin',
  'Manager',
  'Sales Coordinator',
  'Service Coordinator',
  'Executive',
  'Administrator',
  'User',
];

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide your full name'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Please provide an email address'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Please provide a valid email address'],
  },
  username: {
    type: String,
    lowercase: true,
    trim: true,
    default: '',
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 4,
    select: false,
  },
  // Primary role (for backward compatibility & primary title)
  role: {
    type: String,
    default: 'User',
  },
  // Array of roles for multi-role simultaneous assignment
  roles: {
    type: [String],
    default: function () {
      return this.role ? [this.role] : ['User'];
    },
  },
  department: {
    type: String,
    default: 'Internet Work',
  },
  avatar: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['Approved', 'Pending', 'Rejected'],
    default: 'Approved',
  },
  reportsTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  reportsToName: {
    type: String,
    default: '',
  },
  nodeId: {
    type: String,
    default: '',
  },
  nodeType: {
    type: String,
    default: '',
  },
  reportsToNode: {
    type: String,
    default: '',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Synchronize role and roles before saving
userSchema.pre('save', async function (next) {
  if (this.roles && Array.isArray(this.roles) && this.roles.length > 0) {
    if (!this.role || !this.roles.includes(this.role)) {
      this.role = this.roles[0];
    }
  } else if (this.role) {
    this.roles = [this.role];
  } else {
    this.roles = ['User'];
    this.role = 'User';
  }

  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
