const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
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
const { JWT_SECRET } = require('./middleware/auth');
const { securityHeaders, errorHandler } = require('./middleware/security');

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

// Socket.IO Server-Side JWT Authentication & Scoped Authorization Middleware
io.use((socket, next) => {
  try {
    const rawAuth =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization ||
      socket.handshake.query?.token;

    const token = rawAuth ? rawAuth.replace(/^Bearer\s+/i, '').trim() : null;

    if (!token || token === 'null' || token === 'undefined') {
      return next(new Error('Authentication error: Token missing'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    socket.isAuthenticated = true;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid or expired token'));
  }
});

// Attach io to express app so routes can access it via req.app.get('io')
app.set('io', io);

// Socket.io Connection & Verified Room Management
io.on('connection', (socket) => {
  // Always join public broadcast channel
  socket.join('all');

  // If connection is verified, automatically join authorized personal & role rooms
  if (socket.isAuthenticated && socket.user) {
    const user = socket.user;
    const userIdStr = user.id ? user.id.toString() : '';
    const userNameStr = (user.name || '').toLowerCase().trim();
    const userUsernameStr = (user.username || '').toLowerCase().trim();

    if (userIdStr) socket.join(`user:${userIdStr}`);
    if (userUsernameStr) socket.join(`user:${userUsernameStr}`);
    if (userNameStr) socket.join(`user:${userNameStr}`);

    const userRoles = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role || 'User'];
    userRoles.forEach((r) => socket.join(`role:${r}`));

    if (userRoles.some((r) => ['Manager', 'Executive', 'Administrator', 'Super Admin'].includes(r))) {
      socket.join('role:Manager');
    }
  }

  // Handle client-requested room joins safely with server-side validation
  socket.on('join', (data) => {
    try {
      if (!data) return;
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;

      if (socket.isAuthenticated && socket.user) {
        const user = socket.user;
        const authId = user.id ? user.id.toString() : '';
        const authUsername = (user.username || '').toLowerCase().trim();
        const authName = (user.name || '').toLowerCase().trim();
        const isSuperAdmin = user.role === 'Super Admin' || (user.roles || []).includes('Super Admin');

        // Only permit joining rooms belonging to self unless Super Admin
        if (parsed.userId && (parsed.userId.toString() === authId || isSuperAdmin)) {
          socket.join(`user:${parsed.userId.toString()}`);
        }
        if (parsed.username && (parsed.username.toLowerCase().trim() === authUsername || isSuperAdmin)) {
          socket.join(`user:${parsed.username.toLowerCase().trim()}`);
        }
        if (parsed.name && (parsed.name.toLowerCase().trim() === authName || isSuperAdmin)) {
          socket.join(`user:${parsed.name.toLowerCase().trim()}`);
        }
      }
    } catch (err) {
      // Quiet fail
    }
  });
});

// Security HTTP Headers
app.use(securityHeaders);

// CORS configuration
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
app.use('/api/mis', require('./routes/misRoutes'));
app.use('/api/audit-logs', require('./routes/auditRoutes'));
app.use('/api/audit', require('./routes/auditRoutes'));
app.use('/api/followups', require('./routes/followUpRoutes'));

const { initSLADaemon } = require('./services/slaDaemon');
const mongoose = require('mongoose');

// Safe Health check endpoint
app.get('/api/health', (req, res) => {
  const isDbReady = mongoose.connection ? mongoose.connection.readyState === 1 : false;
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    mode: fallbackStore.isFallback ? 'Persistent Fallback Store' : 'MongoDB Production',
    database: fallbackStore.isFallback ? 'ready (fallback)' : (isDbReady ? 'connected' : 'connecting'),
    isDatabaseHealthy: fallbackStore.isFallback ? true : isDbReady,
    activeModules: fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects', 'tasks'],
    socketConnections: io.engine ? io.engine.clientsCount : 0,
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'TaskFlow Pro Enterprise Modular API',
    version: '2.0.0',
    modules: ['Lead Management', 'Complaint Management', 'Project Management', 'Task Management'],
    pricing: 'Module-based annual per-user subscription',
    roles: ['Super Admin', 'Manager', 'Sales Coordinator', 'Service Coordinator', 'User'],
    status: 'Active with WebSockets and Real-time Live Events',
  });
});

// Global Centralized Error handling middleware
app.use(errorHandler);

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

    // Initialize SLA Escalation Daemon
    initSLADaemon(io);

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
      console.log(`📦 Active Modules: ${(fallbackStore.subscription?.activeModules || ['leads', 'complaints', 'projects', 'tasks']).join(', ')}`);
      console.log(`⚡ Real-Time WebSockets / Socket.io Active`);
      console.log(`📊 Mode: ${dbStatus.isFallback ? 'Fallback In-Memory Store' : 'MongoDB Database'}`);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
};

startServer();

module.exports = { app, httpServer, io };
