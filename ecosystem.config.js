const path = require('path');
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: 'crate-dl',
      script: path.join(ROOT, 'dist/index.js'),
      cwd: ROOT,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'chrome',
      script: path.join(ROOT, 'start-chrome.sh'),
      interpreter: 'bash',
      cwd: ROOT,
      autorestart: true,
      watch: false,
    },
    {
      name: 'ngrok',
      script: path.join(ROOT, 'start-ngrok.sh'),
      interpreter: 'bash',
      cwd: ROOT,
      autorestart: true,
      watch: false,
    },
  ],
};
