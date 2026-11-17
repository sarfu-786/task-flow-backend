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

// Exclude test/dummy AI accounts
const AI_EXCLUDED_EMAILS = new Set([
  'sarfu@gmail.com',
  'admin@taskflow.com',
  'rohan.verma@taskflow.com',
  'ananya.iyer@taskflow.com',
  'vikram.malhotra@taskflow.com',
  'neha.gupta@taskflow.com',
  'rajesh.kothari@taskflow.com',
  'kavita.reddy@taskflow.com',
  'sarah.test1788242656501@example.com',
  'manager.1788243837519@company.com',
  'emma.1788243837519@company.com',
]);

const isAiExcludedEmail = (email) => {
  if (!email) return false;
  const clean = email.toLowerCase().trim();
  return AI_EXCLUDED_EMAILS.has(clean) || clean.endsWith('@taskflow.com') || clean.endsWith('@company.com') || clean.endsWith('@example.com');
};

// In-memory & Persistent File-backed fallback data store
const fallbackStore = {
  users: [],
  tasks: [],
  notifications: [],
  leads: [],
  opportunities: [],
  complaints: [],
  projects: [],
  auditLogs: [],
  importHistory: [],
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

  loadBackupLeads() {
    try {
      const backupPath = path.join(__dirname, '../backups/taskflow_backup_2026-10-06T07-23-51-630Z.json');
      if (fs.existsSync(backupPath)) {
        const raw = fs.readFileSync(backupPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.leads) && parsed.leads.length > 0) {
          const isFake = (l) => {
            if (!l) return true;
            const n = (l.name || l.contactPerson || '').trim();
            const e = (l.email || '').trim().toLowerCase();
            const id = (l._id || '').toString();
            const c = (l.company || '').trim();
            if (/Aarav Verma_\d+/i.test(n)) return true;
            if (/Cold Prospect_\d+/i.test(n)) return true;
            if (/MIS Test Enterprise/i.test(n)) return true;
            if (/Confidential Enterprise Lead/i.test(n)) return true;
            if (/Unqualified Test Lead/i.test(n)) return true;
            if (/Vikram Malhotra/i.test(n)) return true;
            if (/Customer With No Email/i.test(n)) return true;
            if (/Isolated Hierarchy Customer Inc/i.test(n)) return true;
            if (/lead_no_email_/i.test(id)) return true;
            if (/vikram_179/i.test(e)) return true;
            if (/vikram\.m@acmeapex/i.test(e)) return true;
            if (/smallshop\.com/i.test(e)) return true;
            if (/entcorp\.com/i.test(e)) return true;
            if (/Acme Apex Corp/i.test(c)) return true;
            return false;
          };

          const genuine = parsed.leads.filter((l) => !isFake(l));
          const allUsers = this.users || parsed.users || [];
          const assignments = {
            'LD-001': 'shoaib',
            'LD-002': 'arif',
            'LD-003': 'saifi',
            'LD-018': 'wasil',
            'LD-019': 'exam',
          };
          genuine.forEach((l) => {
            const lid = l.leadId || l.lead_id;
            if (lid && assignments[lid]) {
              const targetU = allUsers.find((u) => u.username === assignments[lid]);
              if (targetU) {
                l.user = targetU._id;
                l.assignedTo = targetU.name;
                l.assignedSalesUser = targetU.name;
                l.assignedToId = targetU._id;
              }
            }
          });
          return genuine;
        }
      }
    } catch (e) {
      console.warn('[Storage Notice] Could not load backup leads:', e.message);
    }
    return [];
  },

  saveToFile() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!this.leads || this.leads.length === 0) {
        this.leads = this.loadBackupLeads();
      }
      if (Array.isArray(this.users)) {
        this.users = this.users.filter((u) => !isAiExcludedEmail(u.email));
      }
      const payload = {
        users: (this.users || []).filter((u) => !isAiExcludedEmail(u.email)),
        tasks: this.tasks || [],
        notifications: this.notifications || [],
        leads: this.leads || [],
        opportunities: this.opportunities || [],
        complaints: this.complaints || [],
        projects: this.projects || [],
        auditLogs: this.auditLogs || [],
        importHistory: this.importHistory || [],
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
          this.users = parsed.users.filter((u) => !isAiExcludedEmail(u.email));

          // Ensure reportsTo IDs match active user _id based on reportsToName
          const userById = new Map();
          const userByName = new Map();
          this.users.forEach((u) => {
            if (u._id) userById.set(u._id.toString(), u);
            if (u.name) userByName.set(u.name.toLowerCase().trim(), u);
          });
          const superAdminUser = this.users.find((u) => u.role === 'Super Admin' || (u.roles && u.roles.includes('Super Admin')));
          let needsSave = false;
          this.users.forEach((u) => {
            if (u.role === 'Manager' && (!u.reportsTo || !u.reportsToName) && superAdminUser && u._id !== superAdminUser._id) {
              u.reportsTo = superAdminUser._id;
              u.reportsToName = `${superAdminUser.name} (${superAdminUser.role || 'Super Admin'})`;
              needsSave = true;
            } else if (u.reportsToName) {
              const rawRName = (u.reportsToName || '').toLowerCase().trim();
              const cleanRName = rawRName.replace(/\s*\([^)]*\)/g, '').trim();
              const parent = (u.reportsTo && userById.get(u.reportsTo.toString())) || userByName.get(cleanRName) || userByName.get(rawRName);
              if (parent && parent._id && u.reportsTo !== parent._id.toString()) {
                u.reportsTo = parent._id.toString();
                needsSave = true;
              }
            }
          });
          if (needsSave) {
            this.saveToFile();
          }

          this.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
          this.notifications = Array.isArray(parsed.notifications) ? parsed.notifications : [];
          this.leads = Array.isArray(parsed.leads) && parsed.leads.length > 0 ? parsed.leads : this.loadBackupLeads();
          this.opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
          this.complaints = Array.isArray(parsed.complaints) ? parsed.complaints : [];
          this.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
          this.auditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [];
          this.importHistory = Array.isArray(parsed.importHistory) ? parsed.importHistory : [];
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
  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/taskflow_db';

  try {
    mongoose.set('strictQuery', false);
    console.log(`[Database] Connecting to MongoDB at: ${mongoURI}`);

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
      console.warn(`[MongoDB Event] Disconnected from database.`);
      fallbackStore._isFallback = true;
    });

    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      family: 4,
      maxPoolSize: 10,
    });

    console.log(`[Database] MongoDB Connected Successfully to DB: ${mongoose.connection.name}`);
    fallbackStore._isFallback = false;
    fallbackStore.dbError = null;
    return { isFallback: false };
  } catch (error) {
    console.warn(`[Database Notice] MongoDB connection error:`, error.message);
    console.log(`[Database] Operating on persistent file-backed local database store.`);
    fallbackStore._isFallback = true;
    fallbackStore.dbError = error.message;
    fallbackStore.loadFromFile();
    return { isFallback: true };
  }
};

module.exports = { connectDB, fallbackStore };

