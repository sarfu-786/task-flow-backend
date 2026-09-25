const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('[Storage Init Error]', e.message);
  }
}

// In-memory & Persistent File-backed fallback data store
const fallbackStore = {
  users: [],
  tasks: [],
  notifications: [],
  leads: [],
  opportunities: [],
  complaints: [],
  projects: [],
  subscription: {
    organizationName: 'TaskFlow Enterprise Client',
    activeModules: ['leads', 'complaints', 'projects'],
    userSeats: 12,
    currency: 'USD',
    billingCycle: 'Annual',
    status: 'Active',
    renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  _isFallback: true,
  dbError: null,

  get isFallback() {
    return this._isFallback || !mongoose.connection || mongoose.connection.readyState !== 1;
  },
  set isFallback(val) {
    this._isFallback = val;
  },

  saveToFile() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const payload = {
        users: this.users,
        tasks: this.tasks,
        notifications: this.notifications,
        leads: this.leads || [],
        opportunities: this.opportunities || [],
        complaints: this.complaints || [],
        projects: this.projects || [],
        subscription: this.subscription || {
          organizationName: 'TaskFlow Enterprise Client',
          activeModules: ['leads', 'complaints', 'projects'],
          userSeats: 12,
          currency: 'USD',
        },
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Storage Error] Failed to persist data to disk:', err.message);
    }
  },

  loadFromFile() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users)) {
          this.users = parsed.users;
          this.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
          this.notifications = Array.isArray(parsed.notifications) ? parsed.notifications : [];
          this.leads = Array.isArray(parsed.leads) ? parsed.leads : [];
          this.opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
          this.complaints = Array.isArray(parsed.complaints) ? parsed.complaints : [];
          this.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
          if (parsed.subscription && typeof parsed.subscription === 'object') {
            this.subscription = parsed.subscription;
          }
          return true;
        }
      }
    } catch (err) {
      console.error('[Storage Error] Failed to read store.json from disk:', err.message);
    }
    return false;
  },

  async syncWithMongoDB(User, Task, Notification, Lead, Opportunity, Complaint, Project, SubscriptionModel) {
    try {
      if (!User || !Task) return;

      // Ensure all existing users in MongoDB have a status field (default to Approved if undefined)
      try {
        await User.updateMany({ status: { $exists: false } }, { $set: { status: 'Approved' } });
        await User.updateMany({ status: null }, { $set: { status: 'Approved' } });
        // Ensure Sarfaraj is Super Admin
        await User.updateMany(
          { $or: [{ email: 'sarfrajahamad068@gmail.com' }, { username: 'sarfraj' }] },
          { $set: { role: 'Super Admin', roles: ['Super Admin'] } }
        );
      } catch (migErr) {
        console.warn('[Database Migration Notice]', migErr.message);
      }

      // 1. Sync Users
      const dbUsers = await User.find({}).select('+password');
      const dbUserEmails = new Set(dbUsers.map(u => (u.email || '').toLowerCase()));
      const dbUserUsernames = new Set(dbUsers.map(u => (u.username || '').toLowerCase()));

      for (const localUser of this.users) {
        const emailLower = (localUser.email || '').toLowerCase();
        const usernameLower = (localUser.username || '').toLowerCase();

        if (emailLower && !dbUserEmails.has(emailLower) && (!usernameLower || !dbUserUsernames.has(usernameLower))) {
          try {
            const userRoles = Array.isArray(localUser.roles) && localUser.roles.length > 0
              ? localUser.roles
              : [localUser.role || 'User'];

            const newUser = new User({
              name: localUser.name,
              email: localUser.email,
              username: localUser.username,
              password: localUser.password || 'user123',
              role: localUser.role || userRoles[0] || 'User',
              roles: userRoles,
              department: localUser.department || 'Operations',
              avatar: localUser.avatar || '',
              reportsTo: localUser.reportsTo || null,
              reportsToName: localUser.reportsToName || '',
              nodeId: localUser.nodeId || '',
              nodeType: localUser.nodeType || '',
              reportsToNode: localUser.reportsToNode || '',
              createdBy: localUser.createdBy || null,
              status: localUser.status || 'Approved',
              createdAt: localUser.createdAt ? new Date(localUser.createdAt) : new Date(),
            });

            if (localUser.password && localUser.password.startsWith('$2')) {
              newUser.password = localUser.password;
              await User.collection.insertOne(newUser.toObject());
            } else {
              await newUser.save();
            }
            dbUserEmails.add(emailLower);
          } catch (e) {
            console.warn(`[Database Sync] User migrate notice for ${localUser.email}:`, e.message);
          }
        }
      }

      // Re-fetch all users from MongoDB
      const updatedDbUsers = await User.find({}).select('+password');
      this.users = updatedDbUsers.map(u => ({
        _id: u._id.toString(),
        name: u.name,
        email: u.email,
        username: u.username,
        password: u.password,
        role: u.role,
        roles: Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role || 'User'],
        department: u.department,
        avatar: u.avatar || '',
        reportsTo: u.reportsTo || null,
        reportsToName: u.reportsToName || '',
        nodeId: u.nodeId || '',
        nodeType: u.nodeType || '',
        reportsToNode: u.reportsToNode || '',
        createdBy: u.createdBy ? u.createdBy.toString() : null,
        status: u.status || 'Approved',
        createdAt: u.createdAt,
      }));

      // 2. Sync Tasks
      const dbTasks = await Task.find({}).sort({ createdAt: -1 });
      this.tasks = dbTasks.map(t => t.toObject());

      // 3. Sync Notifications
      if (Notification) {
        const dbNotifs = await Notification.find({}).sort({ createdAt: -1 });
        this.notifications = dbNotifs.map(n => n.toObject());
      }

      // 4. Sync Leads
      if (Lead) {
        const dbLeads = await Lead.find({}).sort({ createdAt: -1 });
        this.leads = dbLeads.map(l => l.toObject());
      }

      // 5. Sync Complaints
      if (Complaint) {
        const dbComplaints = await Complaint.find({}).sort({ createdAt: -1 });
        this.complaints = dbComplaints.map(c => c.toObject());
      }

      // 6. Sync Projects
      if (Project) {
        const dbProjects = await Project.find({}).sort({ createdAt: -1 });
        this.projects = dbProjects.map(p => p.toObject());
      }

      // 7. Sync Subscription
      if (SubscriptionModel) {
        let dbSub = await SubscriptionModel.findOne({});
        if (!dbSub) {
          dbSub = await SubscriptionModel.create({
            organizationName: this.subscription?.organizationName || 'TaskFlow Enterprise Client',
            activeModules: this.subscription?.activeModules || ['leads', 'complaints', 'projects'],
            userSeats: this.subscription?.userSeats || 12,
            currency: this.subscription?.currency || 'USD',
          });
        }
        this.subscription = dbSub.toObject();
      }

      this.saveToFile();
      console.log(`[Database Sync] Synced ${this.users.length} users, ${this.tasks.length} tasks, ${(this.leads || []).length} leads, ${(this.complaints || []).length} complaints, ${(this.projects || []).length} projects.`);
    } catch (syncErr) {
      console.error('[Database Sync Error]', syncErr.message);
    }
  }
};

// Initial load on require
fallbackStore.loadFromFile();

const connectDB = async () => {
  let mongoURI = process.env.MONGODB_URI;

  if (!mongoURI || mongoURI.includes('127.0.0.1') || mongoURI.includes('localhost') || !mongoURI.includes('mongodb+srv')) {
    mongoURI = 'mongodb+srv://sarfrajahamad068_db_user:NTAPWfhRqpTYZumh@cluster0.p31lill.mongodb.net/taskflow_db?retryWrites=true&w=majority&appName=Cluster0';
  } else if (mongoURI.includes('mongodb+srv://') && !mongoURI.includes('.mongodb.net/')) {
    mongoURI = mongoURI.replace('.mongodb.net/?', '.mongodb.net/taskflow_db?');
  }

  try {
    mongoose.set('strictQuery', false);
    console.log(`[Database] Attempting connection to MongoDB Atlas...`);

    mongoose.connection.on('connected', () => {
      console.log(`[MongoDB Event] Connected to database: ${mongoose.connection.name}`);
      fallbackStore._isFallback = false;
      fallbackStore.dbError = null;
    });

    mongoose.connection.on('error', (err) => {
      console.error(`[MongoDB Event] Connection error:`, err.message);
      fallbackStore._isFallback = true;
      fallbackStore.dbError = err.message;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn(`[MongoDB Event] Disconnected from Atlas.`);
      fallbackStore._isFallback = true;
    });

    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 2500,
      socketTimeoutMS: 10000,
      family: 4,
      maxPoolSize: 10,
    });

    console.log(`[Database] MongoDB Connected Successfully to Atlas DB: ${mongoose.connection.name}`);
    fallbackStore._isFallback = false;
    fallbackStore.dbError = null;
    return { isFallback: false };
  } catch (error) {
    console.warn(`[Database Notice] MongoDB Atlas connection unavailable:`, error.message);
    console.log(`[Database] Operating on persistent file-backed local database store.`);
    fallbackStore._isFallback = true;
    fallbackStore.dbError = error.message;
    fallbackStore.loadFromFile();
    return { isFallback: true };
  }
};

module.exports = { connectDB, fallbackStore };
