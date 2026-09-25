const express = require('express');
const router = express.Router();
const { Subscription, DEFAULT_MODULE_PRICING } = require('../models/Subscription');
const { protect, checkRole } = require('../middleware/auth');
const { fallbackStore } = require('../config/db');

// Helper to calculate annual billing
const computeBilling = (subObj) => {
  const currency = subObj.currency || 'USD';
  const seats = Number(subObj.userSeats) || 1;
  const activeMods = Array.isArray(subObj.activeModules) ? subObj.activeModules : [];

  let totalAnnualBilling = 0;
  const breakdown = [];

  for (const [modKey, modConfig] of Object.entries(DEFAULT_MODULE_PRICING)) {
    const isSelected = activeMods.includes(modKey);
    const unitPrice =
      currency === 'INR' ? modConfig.annualPriceINR : modConfig.annualPriceUSD;
    const lineTotal = isSelected ? unitPrice * seats : 0;

    if (isSelected) {
      totalAnnualBilling += lineTotal;
    }

    breakdown.push({
      moduleId: modKey,
      name: modConfig.name,
      description: modConfig.description,
      icon: modConfig.icon,
      color: modConfig.color,
      isSelected,
      unitPrice,
      userSeats: seats,
      lineTotal,
      currency,
    });
  }

  return {
    organizationName: subObj.organizationName || 'TaskFlow Enterprise Client',
    activeModules: activeMods,
    userSeats: seats,
    currency,
    billingCycle: 'Annual',
    status: subObj.status || 'Active',
    renewalDate: subObj.renewalDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    totalAnnualBilling,
    activeModuleCount: activeMods.length,
    breakdown,
    catalog: DEFAULT_MODULE_PRICING,
  };
};

// @route   GET /api/subscriptions
// @desc    Get client module subscription & calculated annual pricing
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    if (fallbackStore.isFallback) {
      if (!fallbackStore.subscription) {
        fallbackStore.subscription = {
          organizationName: 'TaskFlow Enterprise Client',
          activeModules: ['leads', 'complaints', 'tasks', 'projects'],
          userSeats: 12,
          currency: 'USD',
          status: 'Active',
        };
      }
      const calculation = computeBilling(fallbackStore.subscription);
      return res.json({ success: true, data: calculation });
    }

    let sub = await Subscription.findOne({});
    if (!sub) {
      sub = await Subscription.create({
        organizationName: 'TaskFlow Enterprise Client',
        activeModules: ['leads', 'complaints', 'tasks', 'projects'],
        userSeats: 12,
        currency: 'USD',
      });
    }

    const calculation = computeBilling(sub.toObject());
    return res.json({ success: true, data: calculation });
  } catch (err) {
    console.error('[Subscription Error]', err);
    res.status(500).json({ success: false, message: 'Server error retrieving subscription' });
  }
});

// @route   PUT /api/subscriptions/modules
// @desc    Update enabled client modules
// @access  Private (Super Admin or Manager)
router.put('/modules', protect, async (req, res) => {
  try {
    const { activeModules } = req.body;
    if (!Array.isArray(activeModules)) {
      return res.status(400).json({ success: false, message: 'activeModules must be an array of module IDs' });
    }

    // Filter valid module IDs
    const validIds = Object.keys(DEFAULT_MODULE_PRICING);
    const sanitizedModules = activeModules.filter((id) => validIds.includes(id));

    let updatedSub;
    if (fallbackStore.isFallback) {
      if (!fallbackStore.subscription) fallbackStore.subscription = {};
      fallbackStore.subscription.activeModules = sanitizedModules;
      fallbackStore.subscription.updatedAt = new Date().toISOString();
      fallbackStore.saveToFile();
      updatedSub = fallbackStore.subscription;
    } else {
      let sub = await Subscription.findOne({});
      if (!sub) {
        sub = new Subscription({});
      }
      sub.activeModules = sanitizedModules;
      sub.updatedAt = new Date();
      await sub.save();
      updatedSub = sub.toObject();
    }

    const calculation = computeBilling(updatedSub);

    // Emit live real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('modules_updated', calculation);
      io.emit('notification', {
        type: 'subscription_updated',
        title: 'Active Modules Updated',
        message: `Active modules configured to: ${sanitizedModules.join(', ')}`,
        timestamp: new Date(),
      });
    }

    return res.json({
      success: true,
      message: 'Active modules updated successfully',
      data: calculation,
    });
  } catch (err) {
    console.error('[Subscription Update Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update modules' });
  }
});

// @route   PUT /api/subscriptions/seats
// @desc    Update user seat count
// @access  Private (Super Admin or Manager)
router.put('/seats', protect, async (req, res) => {
  try {
    const { userSeats } = req.body;
    const seats = parseInt(userSeats, 10);
    if (isNaN(seats) || seats < 1) {
      return res.status(400).json({ success: false, message: 'userSeats must be at least 1' });
    }

    let updatedSub;
    if (fallbackStore.isFallback) {
      if (!fallbackStore.subscription) fallbackStore.subscription = {};
      fallbackStore.subscription.userSeats = seats;
      fallbackStore.subscription.updatedAt = new Date().toISOString();
      fallbackStore.saveToFile();
      updatedSub = fallbackStore.subscription;
    } else {
      let sub = await Subscription.findOne({});
      if (!sub) sub = new Subscription({});
      sub.userSeats = seats;
      sub.updatedAt = new Date();
      await sub.save();
      updatedSub = sub.toObject();
    }

    const calculation = computeBilling(updatedSub);

    const io = req.app.get('io');
    if (io) {
      io.emit('subscription_updated', calculation);
    }

    return res.json({
      success: true,
      message: 'User seats updated successfully',
      data: calculation,
    });
  } catch (err) {
    console.error('[Seats Update Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update user seats' });
  }
});

// @route   PUT /api/subscriptions/currency
// @desc    Toggle USD / INR currency
// @access  Private
router.put('/currency', protect, async (req, res) => {
  try {
    const { currency } = req.body;
    if (!['USD', 'INR'].includes(currency)) {
      return res.status(400).json({ success: false, message: 'Currency must be USD or INR' });
    }

    let updatedSub;
    if (fallbackStore.isFallback) {
      if (!fallbackStore.subscription) fallbackStore.subscription = {};
      fallbackStore.subscription.currency = currency;
      fallbackStore.saveToFile();
      updatedSub = fallbackStore.subscription;
    } else {
      let sub = await Subscription.findOne({});
      if (!sub) sub = new Subscription({});
      sub.currency = currency;
      await sub.save();
      updatedSub = sub.toObject();
    }

    const calculation = computeBilling(updatedSub);
    return res.json({ success: true, data: calculation });
  } catch (err) {
    console.error('[Currency Update Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update currency' });
  }
});

// @route   POST /api/subscriptions/calculate
// @desc    Calculate custom quote or simulate pricing
// @access  Public / Private
router.post('/calculate', (req, res) => {
  try {
    const { activeModules = ['leads', 'complaints', 'tasks', 'projects'], userSeats = 10, currency = 'USD' } = req.body;
    const calculation = computeBilling({
      activeModules,
      userSeats,
      currency,
    });
    return res.json({ success: true, data: calculation });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Calculation error' });
  }
});

module.exports = router;
