module.exports = {
  apps: [
    {
      name: 'taskflow-api',
      script: './server.js',
      instances: 'max', // Utilizes all available CPU cores in cluster mode
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        MONGO_MAX_POOL_SIZE: 50,
        MONGO_MIN_POOL_SIZE: 5,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5000,
        MONGO_MAX_POOL_SIZE: 20,
        MONGO_MIN_POOL_SIZE: 2,
      },
    },
  ],
};
