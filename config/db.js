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
  isFallback: false,
  dbError: null,

  saveToFile() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const payload = {
        users: this.users,
        tasks: this.tasks,
        notifications: this.notifications,
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
          return true;
        }
      }
    } catch (err) {
      console.error('[Storage Error] Failed to read store.json from disk:', err.message);
    }
    return false;
  },

  async syncWithMongoDB(User, Task, Notification) {
    try {
      if (!User || !Task) return;

      // Ensure all existing users in MongoDB have a status field (default to Approved if undefined)
      try {
        await User.updateMany({ status: { $exists: false } }, { $set: { status: 'Approved' } });
        await User.updateMany({ status: null }, { $set: { status: 'Approved' } });
      } catch (migErr) {
        console.warn('[Database Migration Notice]', migErr.message);
      }

      // 1. Sync Users: Transfer local store users into MongoDB if missing
      const dbUsers = await User.find({}).select('+password');
      const dbUserEmails = new Set(dbUsers.map(u => (u.email || '').toLowerCase()));
      const dbUserUsernames = new Set(dbUsers.map(u => (u.username || '').toLowerCase()));

      for (const localUser of this.users) {
        const emailLower = (localUser.email || '').toLowerCase();
        const usernameLower = (localUser.username || '').toLowerCase();

        if (emailLower && !dbUserEmails.has(emailLower) && (!usernameLower || !dbUserUsernames.has(usernameLower))) {
          try {
            const newUser = new User({
              name: localUser.name,
              email: localUser.email,
              username: localUser.username,
              password: localUser.password || 'user123',
              role: localUser.role || 'User',
              department: localUser.department || 'Operations',
              avatar: localUser.avatar || '',
              status: localUser.status || 'Approved',
              createdAt: localUser.createdAt ? new Date(localUser.createdAt) : new Date(),
            });
            // If password was already hashed in localStore, assign directly without double-hashing
            if (localUser.password && localUser.password.startsWith('$2')) {
              newUser.password = localUser.password;
              await User.collection.insertOne(newUser.toObject());
            } else {
              await newUser.save();
            }
            dbUserEmails.add(emailLower);
            console.log(`[Database Sync] Migrated user "${localUser.name}" (${localUser.email}) to MongoDB.`);
          } catch (e) {
            console.warn(`[Database Sync] User migrate notice for ${localUser.email}:`, e.message);
          }
        }
      }

      // Re-fetch all users from MongoDB and update local store
      const updatedDbUsers = await User.find({}).select('+password');
      this.users = updatedDbUsers.map(u => ({
        _id: u._id.toString(),
        name: u.name,
        email: u.email,
        username: u.username,
        password: u.password,
        role: u.role,
        department: u.department,
        avatar: u.avatar || '',
        status: u.status || 'Approved',
        createdAt: u.createdAt,
      }));

      // 2. Sync Tasks: Transfer local tasks into MongoDB if missing
      const dbTasks = await Task.find({});
      const dbTaskIds = new Set(dbTasks.map(t => t._id.toString()));

      for (const localTask of this.tasks) {
        if (localTask._id && !dbTaskIds.has(localTask._id.toString())) {
          try {
            // Find corresponding user in MongoDB
            let targetUserId = undefined;
            if (localTask.assignedTo) {
              const matched = updatedDbUsers.find(
                u => (u.name && u.name.toLowerCase() === localTask.assignedTo.toLowerCase()) ||
                     (u.username && u.username.toLowerCase() === localTask.assignedTo.toLowerCase())
              );
              if (matched) targetUserId = matched._id;
            }

            await Task.create({
              taskType: localTask.taskType || 'internet work',
              description: localTask.description,
              expectedDate: localTask.expectedDate ? new Date(localTask.expectedDate) : new Date(),
              remark: localTask.remark || '',
              completionRemark: localTask.completionRemark || '',
              status: localTask.status || 'To Do',
              priority: localTask.priority || 'Medium',
              assignedTo: localTask.assignedTo || 'Team Member',
              assignedBy: localTask.assignedBy || 'Manager',
              user: targetUserId,
              completedAt: localTask.completedAt ? new Date(localTask.completedAt) : null,
              createdAt: localTask.createdAt ? new Date(localTask.createdAt) : new Date(),
            });
            console.log(`[Database Sync] Migrated task "${localTask.description?.substring(0, 30)}..." to MongoDB.`);
          } catch (e) {
            console.warn(`[Database Sync] Task migrate notice:`, e.message);
          }
        }
      }

      // Re-fetch all tasks from MongoDB and update local store
      const updatedDbTasks = await Task.find({}).sort({ createdAt: -1 });
      this.tasks = updatedDbTasks.map(t => t.toObject());

      // 3. Sync Notifications if Notification model provided
      if (Notification) {
        const dbNotifs = await Notification.find({}).sort({ createdAt: -1 });
        this.notifications = dbNotifs.map(n => n.toObject());
      }

      // Save complete snapshot to local disk
      this.saveToFile();
      console.log(`[Database Sync] Successfully synchronized ${this.users.length} users and ${this.tasks.length} tasks.`);
    } catch (syncErr) {
      console.error('[Database Sync Error]', syncErr.message);
    }
  }
};

// Initial load on require
fallbackStore.loadFromFile();

const connectDB = async () => {
  let mongoURI = process.env.MONGODB_URI;

  // If MONGODB_URI is not provided or points to local address on remote/cloud host
  if (!mongoURI || mongoURI.includes('127.0.0.1') || mongoURI.includes('localhost') || !mongoURI.includes('mongodb+srv')) {
    mongoURI = 'mongodb+srv://sarfrajahamad068_db_user:NTAPWfhRqpTYZumh@cluster0.p31lill.mongodb.net/taskflow_db?retryWrites=true&w=majority&appName=Cluster0';
  } else if (mongoURI.includes('mongodb+srv://') && !mongoURI.includes('.mongodb.net/')) {
    mongoURI = mongoURI.replace('.mongodb.net/?', '.mongodb.net/taskflow_db?');
  }

  try {
    mongoose.set('strictQuery', false);
    console.log(`[Database] Attempting connection to MongoDB Atlas...`);
    
    // Connection event listeners
    mongoose.connection.on('connected', () => {
      console.log(`[MongoDB Event] Connected to database: ${mongoose.connection.name}`);
      fallbackStore.isFallback = false;
      fallbackStore.dbError = null;
    });

    mongoose.connection.on('error', (err) => {
      console.error(`[MongoDB Event] Connection error:`, err.message);
      fallbackStore.dbError = err.message;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn(`[MongoDB Event] Disconnected from Atlas.`);
    });

    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      family: 4, // Force IPv4 to prevent Windows DNS IPv6 resolution failure (ENOTFOUND)
      maxPoolSize: 10,
    });

    console.log(`[Database] MongoDB Connected Successfully to Atlas DB: ${mongoose.connection.name}`);
    fallbackStore.isFallback = false;
    fallbackStore.dbError = null;
    return { isFallback: false };
  } catch (error) {
    console.error(`[Database Error] MongoDB connection failed:`, error.message);
    console.log(`[Database] Initializing persistent file-backed local database store...`);
    fallbackStore.isFallback = true;
    fallbackStore.dbError = error.message;
    fallbackStore.loadFromFile();
    return { isFallback: true };
  }
};

module.exports = { connectDB, fallbackStore };
