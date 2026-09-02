const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB, fallbackStore } = require('./config/db');
const User = require('./models/User');
const Task = require('./models/Task');
const Notification = require('./models/Notification');
const { seedDatabase } = require('./seedData');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
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
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Task Flow Pro API',
    version: '1.0.0',
    description: 'Unified Task Management API is running smoothly',
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

    app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(`🚀 Task Management Server Running on port ${PORT}`);
      console.log(`🌐 API Endpoint: http://localhost:${PORT}/api`);
      console.log(`📊 Mode: ${dbStatus.isFallback ? 'Fallback In-Memory Store' : 'MongoDB Database'}`);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
};

startServer();
