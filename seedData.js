const bcrypt = require('bcryptjs');

const initialUsers = [
  {
    _id: '64e8a1000000000000000001',
    name: 'Sarfaraj Ahmad',
    email: 'sarfrajahamad068@gmail.com',
    username: 'sarfraj',
    password: 'user123',
    role: 'Super Admin',
    roles: ['Super Admin'],
    department: 'Executive Leadership',
    avatar: '',
    reportsTo: null,
    reportsToName: '',
    status: 'Approved',
    createdAt: new Date('2026-01-15T09:00:00Z'),
  },
];

const initialTasks = [];
const initialLeads = [];
const initialComplaints = [];
const initialProjects = [];
const initialOpportunities = [];
const initialNotifications = [];

const initialSubscription = {
  organizationName: 'TaskFlow Enterprise Client',
  activeModules: ['leads', 'complaints', 'tasks', 'projects'],
  userSeats: 12,
  currency: 'USD',
  billingCycle: 'Annual',
  status: 'Active',
  renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
};

const seedDatabase = async (
  isFallback,
  User,
  Task,
  fallbackStore,
  Notification,
  Lead,
  Opportunity,
  Complaint,
  Project,
  SubscriptionModel
) => {
  try {
    const salt = await bcrypt.genSalt(10);
    const defaultHashedPassword = await bcrypt.hash('user123', salt);

    if (isFallback) {
      if (!fallbackStore.users) fallbackStore.users = [];

      for (const u of initialUsers) {
        const existingIdx = fallbackStore.users.findIndex(
          (ex) =>
            (ex.email && ex.email.toLowerCase() === u.email.toLowerCase()) ||
            (ex.username && ex.username.toLowerCase() === u.username.toLowerCase()) ||
            (ex._id && ex._id.toString() === u._id.toString())
        );

        const hashed = defaultHashedPassword;
        const userObj = {
          ...u,
          password: hashed,
          roles: Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || 'User'],
          status: 'Approved',
        };

        if (existingIdx >= 0) {
          fallbackStore.users[existingIdx] = {
            ...fallbackStore.users[existingIdx],
            ...userObj,
          };
        } else {
          fallbackStore.users.unshift(userObj);
        }
      }

      if (!fallbackStore.tasks) {
        fallbackStore.tasks = initialTasks;
      }
      if (!fallbackStore.leads) {
        fallbackStore.leads = initialLeads;
      }
      if (!fallbackStore.complaints) {
        fallbackStore.complaints = initialComplaints;
      }
      if (!fallbackStore.projects) {
        fallbackStore.projects = initialProjects;
      }
      if (!fallbackStore.opportunities) {
        fallbackStore.opportunities = initialOpportunities;
      }
      if (!fallbackStore.subscription) {
        fallbackStore.subscription = initialSubscription;
      }

      fallbackStore.saveToFile();
      console.log(
        `[Storage] Seeded persistent store: ${fallbackStore.users.length} users.`
      );
    } else {
      // MongoDB Seeding
      if (User) {
        const count = await User.countDocuments();
        if (count === 0) {
          for (const u of initialUsers) {
            await User.create({
              ...u,
              password: 'user123',
              roles: u.roles || [u.role || 'User'],
            });
          }
        }
      }

      if (fallbackStore && typeof fallbackStore.syncWithMongoDB === 'function') {
        await fallbackStore.syncWithMongoDB(
          User,
          Task,
          Notification,
          Lead,
          Opportunity,
          Complaint,
          Project,
          SubscriptionModel
        );
      }
    }
  } catch (err) {
    console.error('[Seed Database Error]', err);
  }
};

module.exports = {
  seedDatabase,
  initialUsers,
  initialTasks,
  initialLeads,
  initialComplaints,
  initialProjects,
  initialSubscription,
  initialOpportunities,
  initialNotifications,
};
