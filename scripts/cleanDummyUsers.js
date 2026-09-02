const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Task = require('../models/Task');

const DUMMY_EMAILS = [
  'priya571@gmail.com',
  'tanya849@gmail.com',
  'user_internet_work49@gmail.com',
  'user_documentation44@gmail.com',
  'user_backend16@gmail.com',
  'user_social_media50@gmail.com'
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://sarfrajahamad068_db_user:NTAPWfhRqpTYZumh@cluster0.p31lill.mongodb.net/taskflow_db?retryWrites=true&w=majority&appName=Cluster0');
    
    // 1. Remove dummy users matching emails or dummy names
    const delUsersRes = await User.deleteMany({
      $or: [
        { email: { $in: DUMMY_EMAILS } },
        { name: /^User (Internet|Documentation|Backend|Social)/i },
        { name: /^Rahul Sharma/i }
      ]
    });
    console.log('Deleted dummy users from MongoDB Atlas:', delUsersRes.deletedCount);

    // 2. Remove dummy task
    const delTaskRes = await Task.deleteMany({
      $or: [
        { assignedTo: 'Rahul Sharma' },
        { description: /^Build robust database/i }
      ]
    });
    console.log('Deleted dummy tasks from MongoDB Atlas:', delTaskRes.deletedCount);

    // 3. Clean up store.json
    const storePath = path.join(__dirname, '..', 'data', 'store.json');
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, 'utf8');
      const store = JSON.parse(raw);
      
      store.users = (store.users || []).filter(u => {
        if (DUMMY_EMAILS.includes(u.email)) return false;
        if (u.name && u.name.startsWith('User ')) return false;
        if (u.name === 'Rahul Sharma' || (u.email && u.email.startsWith('rahul'))) return false;
        if (u.name === 'Priya Verma' || u.name === 'Tanya Sen') return false;
        return true;
      });

      store.tasks = (store.tasks || []).filter(t => {
        if (t.assignedTo === 'Rahul Sharma') return false;
        if (t.description && t.description.includes('Build robust database')) return false;
        return true;
      });

      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
      console.log('Updated store.json. Remaining users count:', store.users.length);
    }

    const finalUsers = await User.find({});
    console.log('Final Users in Atlas:', finalUsers.map(u => ({ name: u.name, email: u.email, role: u.role, dept: u.department })));

    process.exit(0);
  } catch (err) {
    console.error('Cleanup error:', err);
    process.exit(1);
  }
})();
