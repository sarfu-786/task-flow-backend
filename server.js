const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const { connectDB, fallbackStore } = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Notification = require('./models/Notification');
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
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Handle client joining user/role rooms
  socket.on('join', (data) => {
    try {
      if (!data) return;
      const { userId, username, role, name } = typeof data === 'string' ? JSON.parse(data) : data;

      if (userId) {
        socket.join(`user:${userId.toString()}`);
        console.log(`[Socket.io] ${socket.id} joined room user:${userId}`);
      }
      if (username) {
        socket.join(`user:${username.toString().toLowerCase().trim()}`);
      }
      if (name) {
        socket.join(`user:${name.toString().toLowerCase().trim()}`);
      }
      if (role) {
        socket.join(`role:${role}`);
        if (['Manager', 'Executive', 'Administrator'].includes(role)) {
          socket.join('role:Manager');
        }
        console.log(`[Socket.io] ${socket.id} joined role:${role}`);
      }
      socket.join('all');
    } catch (err) {
      console.warn('[Socket.io] Join error:', err.message);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);
  });
});

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests from all origins (including Vercel, localhost, and custom domains)
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));

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
    socketConnections: io.engine.clientsCount,
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Task Flow Pro API',
    version: '1.0.0',
    description: 'Unified Task Management API is running smoothly with Real-Time Socket.io',
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
    await seedDatabase(dbStatus.isFallback, User, Task, fallbackStore, Notification);

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
      console.log(`🚀 Task Management Server Running on port ${PORT}`);
      console.log(`🌐 API Endpoint: http://localhost:${PORT}/api`);
      console.log(`⚡ Real-Time WebSockets / Socket.io Active`);
      console.log(`📊 Mode: ${dbStatus.isFallback ? 'Fallback In-Memory Store' : 'MongoDB Database'}`);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
};

startServer();
