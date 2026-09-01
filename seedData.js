const bcrypt = require('bcryptjs');

const initialUsers = [
  {
    _id: '64e8a1000000000000000001',
    name: 'Sarfaraj Ahmad',
    email: 'sarfrajahamad068@gmail.com',
    username: 'sarfraj',
    password: '998466',
    role: 'Manager',
    department: 'Management',
    avatar: '',
    createdAt: new Date('2026-01-15T09:00:00Z'),
  },
  {
    _id: '64e8a1000000000000000002',
    name: 'Priya Patel',
    email: 'admin@taskflow.com',
    username: 'admin',
    password: 'admin123',
    role: 'Executive',
    department: 'System Architecture',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    createdAt: new Date('2026-01-10T08:30:00Z'),
  },
  {
    _id: '64e8a1000000000000000003',
    name: 'Rohan Verma',
    email: 'rohan.verma@taskflow.com',
    username: 'rohan',
    password: 'user123',
    role: 'User',
    department: 'Backend Engineering',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    createdAt: new Date('2026-02-01T10:00:00Z'),
  },
  {
    _id: '64e8a1000000000000000004',
    name: 'Ananya Iyer',
    email: 'ananya.iyer@taskflow.com',
    username: 'ananya',
    password: 'user123',
    role: 'User',
    department: 'Content & Documentation',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    createdAt: new Date('2026-02-10T11:00:00Z'),
  },
  {
    _id: '64e8a1000000000000000005',
    name: 'Vikram Malhotra',
    email: 'vikram.malhotra@taskflow.com',
    username: 'vikram',
    password: 'user123',
    role: 'Manager',
    department: 'Cloud Infrastructure',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    createdAt: new Date('2026-02-15T09:30:00Z'),
  },
  {
    _id: '64e8a1000000000000000006',
    name: 'Neha Gupta',
    email: 'neha.gupta@taskflow.com',
    username: 'neha',
    password: 'user123',
    role: 'User',
    department: 'Digital Marketing',
    avatar: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80',
    createdAt: new Date('2026-02-20T14:00:00Z'),
  },
  {
    _id: '64e8a1000000000000000007',
    name: 'Rajesh Kothari',
    email: 'rajesh.kothari@taskflow.com',
    username: 'rajesh',
    password: 'user123',
    role: 'Executive',
    department: 'Operations & Strategy',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    createdAt: new Date('2026-02-22T10:00:00Z'),
  },
  {
    _id: '64e8a1000000000000000008',
    name: 'Kavita Reddy',
    email: 'kavita.reddy@taskflow.com',
    username: 'kavita',
    password: 'user123',
    role: 'User',
    department: 'Quality Assurance',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    createdAt: new Date('2026-02-25T11:00:00Z'),
  }
];

const initialTasks = [
  {
    _id: '64e8b2000000000000000001',
    taskType: 'internet work',
    description: 'Conduct market research on UPI payments gateway integration and latency benchmarks',
    expectedDate: new Date('2026-09-05T18:00:00Z'),
    remark: 'Compare Razorpay, Cashfree, and PayU fee structures and SDK support',
    completionRemark: '',
    status: 'In Progress',
    priority: 'High',
    assignedTo: 'Sarfu',
    assignedBy: 'Priya Patel (Executive)',
    createdAt: new Date('2026-08-20T10:00:00Z'),
  },
  {
    _id: '64e8b2000000000000000002',
    taskType: 'documentation',
    description: 'Draft API documentation for Aadhaar eKYC and Digilocker verification endpoints',
    expectedDate: new Date('2026-09-02T17:00:00Z'),
    remark: 'Include request/response payloads, error status codes, and curl examples',
    completionRemark: 'Comprehensive API documentation authored with Swagger specs and Postman collections.',
    status: 'Completed',
    priority: 'Medium',
    assignedTo: 'Ananya Iyer',
    assignedBy: 'Sarfu (Manager)',
    completedAt: new Date('2026-08-28T16:00:00Z'),
    createdAt: new Date('2026-08-22T11:30:00Z'),
  },
  {
    _id: '64e8b2000000000000000003',
    taskType: 'backend work',
    description: 'Implement JWT authentication and role-based access control middleware in Node.js',
    expectedDate: new Date('2026-09-01T15:00:00Z'),
    remark: 'Ensure token expiration is 24 hours with refresh token rotation support',
    completionRemark: 'Completed JWT auth middleware with bcrypt password hashing and RBAC token payload checks.',
    status: 'Completed',
    priority: 'High',
    assignedTo: 'Rohan Verma',
    assignedBy: 'Sarfu (Manager)',
    completedAt: new Date('2026-08-29T14:30:00Z'),
    createdAt: new Date('2026-08-23T09:15:00Z'),
  },
  {
    _id: '64e8b2000000000000000004',
    taskType: 'social media',
    description: 'Prepare creative banner assets and promotional copy for Diwali festival campaign',
    expectedDate: new Date('2026-09-10T12:00:00Z'),
    remark: 'Schedule posts across Twitter/X, LinkedIn, and Instagram channels',
    completionRemark: '',
    status: 'To Do',
    priority: 'Medium',
    assignedTo: 'Neha Gupta',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-24T14:00:00Z'),
  },
  {
    _id: '64e8b2000000000000000005',
    taskType: 'internet work',
    description: 'Research high-speed CDN edge node latency across Mumbai, Bengaluru, and Delhi hubs',
    expectedDate: new Date('2026-09-08T16:00:00Z'),
    remark: 'Focus on regional ISP routing and cloud edge acceleration',
    completionRemark: '',
    status: 'In Progress',
    priority: 'Medium',
    assignedTo: 'Rohan Verma',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-25T08:45:00Z'),
  },
  {
    _id: '64e8b2000000000000000006',
    taskType: 'documentation',
    description: 'Update employee onboarding handbook and IT security protocol guidelines',
    expectedDate: new Date('2026-09-12T17:00:00Z'),
    remark: 'Verify all screenshots correspond to latest system redesign release',
    completionRemark: '',
    status: 'To Do',
    priority: 'Low',
    assignedTo: 'Ananya Iyer',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-25T13:20:00Z'),
  },
  {
    _id: '64e8b2000000000000000007',
    taskType: 'backend work',
    description: 'Design MongoDB aggregation pipelines for Manager Dashboard metrics and KPIs',
    expectedDate: new Date('2026-09-04T18:00:00Z'),
    remark: 'Add compound indexes on taskType and status for sub-millisecond query performance',
    completionRemark: '',
    status: 'In Progress',
    priority: 'High',
    assignedTo: 'Rohan Verma',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-26T10:00:00Z'),
  },
  {
    _id: '64e8b2000000000000000008',
    taskType: 'social media',
    description: 'Analyze weekly audience engagement analytics for tech webinars across India tech community',
    expectedDate: new Date('2026-09-03T14:00:00Z'),
    remark: 'Highlight top 3 best performing posts and follower growth rates',
    completionRemark: 'Engagement metrics compiled with 28% increase in organic reach.',
    status: 'Completed',
    priority: 'Low',
    assignedTo: 'Neha Gupta',
    assignedBy: 'Sarfu (Manager)',
    completedAt: new Date('2026-08-28T18:00:00Z'),
    createdAt: new Date('2026-08-26T15:30:00Z'),
  },
  {
    _id: '64e8b2000000000000000009',
    taskType: 'backend work',
    description: 'Setup automated SMS notification gateway integration via Gupshup & Twilio',
    expectedDate: new Date('2026-09-07T11:00:00Z'),
    remark: 'Ensure DLT template registration compliance for OTP messages',
    completionRemark: '',
    status: 'To Do',
    priority: 'Medium',
    assignedTo: 'Rohan Verma',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-27T09:00:00Z'),
  },
  {
    _id: '64e8b2000000000000000010',
    taskType: 'internet work',
    description: 'Audit SSL/TLS certificates and evaluate multi-cloud data sovereignty compliance',
    expectedDate: new Date('2026-09-15T16:00:00Z'),
    remark: 'Ensure compliance with Indian DPDP Act regulations',
    completionRemark: '',
    status: 'To Do',
    priority: 'High',
    assignedTo: 'Kavita Reddy',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-27T16:00:00Z'),
  },
  {
    _id: '64e8b2000000000000000011',
    taskType: 'documentation',
    description: 'Write developer setup guide with Docker compose file and environment variable template',
    expectedDate: new Date('2026-09-06T13:00:00Z'),
    remark: 'Ensure single-command startup for both frontend and backend',
    completionRemark: '',
    status: 'In Progress',
    priority: 'Medium',
    assignedTo: 'Ananya Iyer',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-28T10:30:00Z'),
  },
  {
    _id: '64e8b2000000000000000012',
    taskType: 'social media',
    description: 'Coordinate Bengaluru developer meetup tech session and prepare presentation deck',
    expectedDate: new Date('2026-09-18T19:00:00Z'),
    remark: 'Collect community questions from Discord and LinkedIn polls',
    completionRemark: '',
    status: 'To Do',
    priority: 'Low',
    assignedTo: 'Neha Gupta',
    assignedBy: 'Sarfu (Manager)',
    createdAt: new Date('2026-08-28T14:00:00Z'),
  }
];

const initialNotifications = [
  {
    _id: '64e8c3000000000000000001',
    userName: 'Rohan Verma',
    userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    taskId: '64e8b2000000000000000003',
    taskDescription: 'Implement JWT authentication and role-based access control middleware in Node.js',
    taskType: 'backend work',
    type: 'task_completed',
    title: 'Task Completed: Rohan Verma',
    message: 'Rohan Verma has completed "Implement JWT authentication and role-based access..."',
    remark: 'Completed JWT auth middleware with bcrypt password hashing and RBAC token payload checks.',
    isRead: false,
    forRole: 'Manager',
    createdAt: new Date('2026-08-29T14:30:00Z'),
  },
  {
    _id: '64e8c3000000000000000002',
    userName: 'Ananya Iyer',
    userAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    taskId: '64e8b2000000000000000002',
    taskDescription: 'Draft API documentation for Aadhaar eKYC and Digilocker verification endpoints',
    taskType: 'documentation',
    type: 'task_completed',
    title: 'Task Completed: Ananya Iyer',
    message: 'Ananya Iyer has completed "Draft API documentation for Aadhaar eKYC..."',
    remark: 'Comprehensive API documentation authored with Swagger specs and Postman collections.',
    isRead: false,
    forRole: 'Manager',
    createdAt: new Date('2026-08-28T16:00:00Z'),
  },
  {
    _id: '64e8c3000000000000000003',
    userName: 'Neha Gupta',
    userAvatar: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80',
    taskId: '64e8b2000000000000000008',
    taskDescription: 'Analyze weekly audience engagement analytics for tech webinars across India tech community',
    taskType: 'social media',
    type: 'task_completed',
    title: 'Task Completed: Neha Gupta',
    message: 'Neha Gupta has completed "Analyze weekly audience engagement analytics..."',
    remark: 'Engagement metrics compiled with 28% increase in organic reach.',
    isRead: true,
    forRole: 'Manager',
    createdAt: new Date('2026-08-28T18:00:00Z'),
  }
];

const seedDatabase = async (isFallback, User, Task, fallbackStore) => {
  try {
    const managerEmail = 'sarfrajahamad068@gmail.com';
    const managerPassword = '998466';

    if (isFallback) {
      const isLoaded = fallbackStore.loadFromFile();
      if (!isLoaded || !fallbackStore.users || fallbackStore.users.length === 0) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(managerPassword, salt);
        fallbackStore.users = [
          {
            _id: '64e8a10676ef8300000000',
            name: 'Sarfaraj Ahmad',
            email: managerEmail,
            username: 'sarfraj',
            password: hashedPassword,
            role: 'Manager',
            department: 'Management',
            avatar: '',
            createdAt: new Date(),
          }
        ];
        fallbackStore.tasks = fallbackStore.tasks || [];
        fallbackStore.notifications = fallbackStore.notifications || [];
        fallbackStore.saveToFile();
      } else {
        // Ensure default manager exists and has updated credentials
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(managerPassword, salt);
        const managerIndex = fallbackStore.users.findIndex(
          (u) => u.email.toLowerCase() === managerEmail.toLowerCase() || u.role === 'Manager'
        );

        if (managerIndex !== -1) {
          fallbackStore.users[managerIndex].name = 'Sarfaraj Ahmad';
          fallbackStore.users[managerIndex].email = managerEmail;
          fallbackStore.users[managerIndex].username = 'sarfraj';
          fallbackStore.users[managerIndex].password = hashedPassword;
          fallbackStore.users[managerIndex].role = 'Manager';
          fallbackStore.users[managerIndex].department = 'Management';
        } else {
          fallbackStore.users.unshift({
            _id: '64e8a10676ef8300000000',
            name: 'Sarfaraj Ahmad',
            email: managerEmail,
            username: 'sarfraj',
            password: hashedPassword,
            role: 'Manager',
            department: 'Management',
            avatar: '',
            createdAt: new Date(),
          });
        }
        fallbackStore.saveToFile();
      }
      console.log(`[Storage] Default manager (${managerEmail}) verified in persistent store.`);
    } else {
      // MongoDB initialization
      if (User) {
        let manager = await User.findOne({ email: managerEmail });
        if (!manager) {
          manager = await User.findOne({ role: 'Manager' });
          if (manager) {
            manager.name = 'Sarfaraj Ahmad';
            manager.email = managerEmail;
            manager.username = 'sarfraj';
            manager.password = managerPassword;
            manager.role = 'Manager';
            manager.department = 'Management';
            await manager.save();
          } else {
            await User.create({
              name: 'Sarfaraj Ahmad',
              email: managerEmail,
              username: 'sarfraj',
              password: managerPassword,
              role: 'Manager',
              department: 'Management',
            });
          }
        } else {
          manager.password = managerPassword;
          manager.role = 'Manager';
          await manager.save();
        }
        console.log(`[Database] Default manager (${managerEmail}) verified in MongoDB.`);
      }
    }
  } catch (error) {
    console.error('[Storage Init Error]:', error.message);
  }
};

module.exports = { seedDatabase, initialUsers, initialTasks, initialNotifications };
