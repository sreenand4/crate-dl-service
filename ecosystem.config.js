module.exports = {
  apps: [
    {
      name: 'crate-dl',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/crate/logs/crate-dl-error.log',
      out_file: '/home/crate/logs/crate-dl-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'crate-dl-keepalive',
      script: 'dist/keepalive.js',
      instances: 1,
      autorestart: true,
      watch: false,
      cron_restart: '0 */6 * * *',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/home/crate/logs/keepalive-error.log',
      out_file: '/home/crate/logs/keepalive-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
