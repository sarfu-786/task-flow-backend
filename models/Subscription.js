const mongoose = require('mongoose');

// Default annual prices per user per module
const DEFAULT_MODULE_PRICING = {
  leads: {
    id: 'leads',
    name: 'Lead Management',
    description: 'Full CRM pipeline, lead scoring, deal tracking & sales coordinator assignment',
    annualPriceUSD: 120,
    annualPriceINR: 9999,
    icon: 'Target',
    color: '#2563eb',
  },
  complaints: {
    id: 'complaints',
    name: 'Complaint Management',
    description: 'Post-sales ticketing, SLA countdown alerts, RCA, CSAT & service coordinator routing',
    annualPriceUSD: 100,
    annualPriceINR: 7999,
    icon: 'AlertCircle',
    color: '#dc2626',
  },
  tasks: {
    id: 'tasks',
    name: 'Task Management',
    description: 'Organizational task workflows, hierarchy assignment, priority matrix & status tracking',
    annualPriceUSD: 80,
    annualPriceINR: 5999,
    icon: 'CheckSquare',
    color: '#0891b2',
  },
  projects: {
    id: 'projects',
    name: 'Project Management',
    description: 'Project lifecycle, milestone tracking, budget monitoring & team deliverables',
    annualPriceUSD: 150,
    annualPriceINR: 11999,
    icon: 'FolderKanban',
    color: '#059669',
  },
};

const subscriptionSchema = new mongoose.Schema({
  organizationName: {
    type: String,
    default: 'TaskFlow Enterprise Client',
    trim: true,
  },
  // Enabled modules for this client
  activeModules: {
    type: [String],
    enum: ['leads', 'complaints', 'tasks', 'projects'],
    default: ['leads', 'complaints', 'tasks', 'projects'],
  },
  // Number of user seats purchased
  userSeats: {
    type: Number,
    default: 12,
    min: 1,
  },
  // Currency selection: USD or INR
  currency: {
    type: String,
    enum: ['USD', 'INR'],
    default: 'USD',
  },
  // Custom module pricing override (if any)
  modulePricing: {
    type: Map,
    of: {
      annualPriceUSD: Number,
      annualPriceINR: Number,
    },
    default: {},
  },
  billingCycle: {
    type: String,
    enum: ['Annual'],
    default: 'Annual',
  },
  renewalDate: {
    type: Date,
    default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  },
  status: {
    type: String,
    enum: ['Active', 'Trial', 'Expired', 'Suspended'],
    default: 'Active',
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Helper calculation method
subscriptionSchema.methods.calculateAnnualBilling = function () {
  const currency = this.currency || 'USD';
  const seats = this.userSeats || 1;
  const activeMods = this.activeModules || [];

  let subtotal = 0;
  const breakdown = [];

  for (const modKey of Object.keys(DEFAULT_MODULE_PRICING)) {
    const isSelected = activeMods.includes(modKey);
    const modConfig = DEFAULT_MODULE_PRICING[modKey];
    const unitPrice =
      currency === 'INR' ? modConfig.annualPriceINR : modConfig.annualPriceUSD;
    const lineTotal = isSelected ? unitPrice * seats : 0;

    if (isSelected) {
      subtotal += lineTotal;
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
    totalAnnualBilling: subtotal,
    currency,
    userSeats: seats,
    activeModuleCount: activeMods.length,
    activeModules: activeMods,
    breakdown,
  };
};

module.exports = {
  Subscription: mongoose.model('Subscription', subscriptionSchema),
  DEFAULT_MODULE_PRICING,
};
