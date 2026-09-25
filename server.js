const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const { connectDB, fallbackStore } = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Notification = require('./models/Notification');
const Lead = require('./models/Lead');
const Opportunity = require('./models/Opportunity');
const Complaint = require('./models/Complaint');
const Project = require('./models/Project');
const { Subscription } = require('./models/Subscription');
const { seedDatabase } = require('./seedData');

// Load environment variables
dotenv.config();

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Socket.io initialization with open CORS for real-time live events
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 10000,
});

// Attach io to express app so routes can access it via req.app.get('io')
app.set('io', io);

// Socket.io Connection & Room Management
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    try {
      if (!data) return;
      const { userId, username, role, roles, name } = typeof data === 'string' ? JSON.parse(data) : data;

      if (userId) {
        socket.join(`user:${userId.toString()}`);
      }
      if (username) {
        socket.join(`user:${username.toString().toLowerCase().trim()}`);
      }
      if (name) {
        socket.join(`user:${name.toString().toLowerCase().trim()}`);
      }
      const userRoles = Array.isArray(roles) && roles.length > 0 ? roles : [role || 'User'];
      userRoles.forEach((r) => {
        socket.join(`role:${r}`);
      });
      if (userRoles.some((r) => ['Manager', 'Executive', 'Administrator', 'Super Admin'].includes(r))) {
        socket.join('role:Manager');
      }
      socket.join('all');
    } catch (err) {
      // quiet join
    }
  });
});

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  })
);
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Core API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/hierarchy', require('./routes/hierarchyRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/leads', require('./routes/leadRoutes'));
app.use('/api/opportunities', require('./routes/opportunityRoutes'));
app.use('/api/complaints', require('./routes/complaintRoutes'));
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/subscriptions', require('./routes/subscriptionRoutes'));
app.use('/api/subscription', require('./routes/subscriptionRoutes'));

const mongoose = require('mongoose');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    database: fallbackStore.isFallback ? 'In-Memory / Persistent Store' : 'MongoDB Atlas Live Connected',
    dbName: mongoose.connection ? mongoose.connection.name : 'none',
    readyState: mongoose.connection ? mongoose.connection.readyState : 0,
    dbError: fallbackStore.dbError || null,
    activeModules: fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects'],
    socketConnections: io.engine.clientsCount,
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'TaskFlow Pro Enterprise Modular API',
    version: '2.0.0',
    modules: ['Lead Management', 'Complaint Management', 'Project Management'],
    pricing: 'Module-based annual per-user subscription',
    roles: ['Super Admin', 'Manager', 'Sales Coordinator', 'Service Coordinator'],
    status: 'Active with WebSockets and Real-time Live Events',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start Server and Initialize DB
const startServer = async () => {
  try {
    const dbStatus = await connectDB();
    await seedDatabase(
      dbStatus.isFallback,
      User,
      Task,
      fallbackStore,
      Notification,
      Lead,
      Opportunity,
      Complaint,
      Project,
      Subscription
    );

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ [Server Error] Port ${PORT} is already in use by another running instance.`);
        console.error(`💡 Tip: Close any existing terminal running node/nodemon or kill the process on port ${PORT}.\n`);
      } else {
        console.error('[Server Error]', err);
      }
    });

    httpServer.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(`🚀 TaskFlow Pro Enterprise Server Running on port ${PORT}`);
      console.log(`🌐 API Endpoint: http://localhost:${PORT}/api`);
      console.log(`📦 Active Modules: ${(fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects']).join(', ')}`);
      console.log(`⚡ Real-Time WebSockets / Socket.io Active`);
      console.log(`📊 Mode: ${dbStatus.isFallback ? 'Fallback In-Memory Store' : 'MongoDB Database'}`);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
};

startServer();

module.exports = { app, httpServer };
