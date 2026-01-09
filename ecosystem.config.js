const fs = require('fs');
const path = require('path');

// Base configuration for a single bot instance
function createBotConfig(envFile, appName) {
  return {
    name: appName,
    script: './src/index.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Shanghai',
      ENV_FILE: path.join(__dirname, envFile)
    },
    error_file: `./logs/${envFile.replace('.env', '')}-error.log`,
    out_file: `./logs/${envFile.replace('.env', '')}-out.log`,
    log_file: `./logs/${envFile.replace('.env', '')}-combined.log`,
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss UTC+8',
    merge_logs: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000
  };
}

// Start with primary bot
const apps = [createBotConfig('.env', 'standx-maker-bot')];

// Add additional bots if .env files exist
const additionalEnvs = ['.env.account2', '.env.account3'];
additionalEnvs.forEach((envFile, index) => {
  if (fs.existsSync(path.join(__dirname, envFile))) {
    apps.push(createBotConfig(envFile, `standx-maker-bot-${index + 2}`));
  }
});

module.exports = { apps };
