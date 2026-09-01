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
};

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
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 30000,
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
    return { isFallback: true };
  }
};

module.exports = { connectDB, fallbackStore };
