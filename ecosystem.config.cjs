// PM2 Ecosystem Configuration
// See: https://pm2.keymetrics.io/docs/usage/application-declaration/
//
// Commands:
//   pm2 start ecosystem.config.js  - Start all agents
//   pm2 restart all                - Restart all agents (fast)
//   pm2 restart dev                - Restart one agent
//   pm2 status                     - View status
//   pm2 logs                       - View logs
//   pm2 stop all                   - Stop all agents
//
// Safe Deployment (recommended for code changes):
//   ./scripts/safe-deploy.sh       - Canary deployment with health checks
//
// Health Check Settings:
//   min_uptime: 60000 (60s) - Agent must run 60s to be "healthy"
//   max_restarts: 3         - Stop trying after 3 consecutive crashes

module.exports = {
  apps: [
    {
      name: 'po',
      script: 'dist/index.js',
      cwd: __dirname,
      env: {
        AGENT_NAME: 'po',
      },
      // Restart on crash
      autorestart: true,
      // Agent must run for 60s to be considered a successful start
      // Used by safe-deploy.sh for health checks
      min_uptime: 60000,
      // Stop restarting after 3 consecutive crashes
      max_restarts: 3,
      // Wait 5s between restart attempts
      restart_delay: 5000,
      // Don't watch for file changes (we use manual restarts)
      watch: false,
    },
    {
      name: 'dev',
      script: 'dist/index.js',
      cwd: __dirname,
      env: {
        AGENT_NAME: 'dev',
      },
      autorestart: true,
      min_uptime: 60000,
      max_restarts: 3,
      restart_delay: 5000,
      watch: false,
    },
    {
      name: 'qa',
      script: 'dist/index.js',
      cwd: __dirname,
      env: {
        AGENT_NAME: 'qa',
      },
      autorestart: true,
      min_uptime: 60000,
      max_restarts: 3,
      restart_delay: 5000,
      watch: false,
    },
    {
      name: 'architect',
      script: 'dist/index.js',
      cwd: __dirname,
      env: {
        AGENT_NAME: 'architect',
      },
      autorestart: true,
      min_uptime: 60000,
      max_restarts: 3,
      restart_delay: 5000,
      watch: false,
    },
  ],
};
