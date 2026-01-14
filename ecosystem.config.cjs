const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Try to find Bun executable
let bunPath = null;
try {
  bunPath = execSync('which bun', { encoding: 'utf8' }).trim();
} catch (e) {
  // Bun not found
}

// Detect if Bun should be used
const useBun = bunPath && (
  fs.existsSync(path.join(__dirname, 'bun.lockb')) ||
  process.env.USE_BUN === 'true' ||
  fs.existsSync(path.join(__dirname, 'node_modules/.bun'))
);

// Generate log file name from env file (e.g., '.env' -> 'main', '.env.account2' -> 'account2')
function getLogFilePrefix(envFile) {
  if (envFile === '.env') return 'main';
  return envFile.replace('.env.', '').replace('.env', '');
}

// Base configuration for a single bot instance
function createBotConfig(envFile, appName) {
  const prefix = getLogFilePrefix(envFile);

  if (useBun) {
    // Bun configuration - faster startup, lower memory
    return {
      name: appName,
      script: path.join(__dirname, 'src/index.ts'),
      interpreter: bunPath,
      interpreter_args: 'src/index.ts',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Shanghai',
        ENV_FILE: path.join(__dirname, envFile)
      },
      error_file: `./logs/${prefix}-error.log`,
      out_file: `./logs/${prefix}-out.log`,
      log_file: `./logs/${prefix}-combined.log`,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss UTC+8',
      merge_logs: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000
    };
  }

  // Node.js configuration (fallback)
  return {
    name: appName,
    script: path.join(__dirname, 'dist/index.js'),
    interpreter: 'node',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Shanghai',
      ENV_FILE: path.join(__dirname, envFile)
    },
    error_file: `./logs/${prefix}-error.log`,
    out_file: `./logs/${prefix}-out.log`,
    log_file: `./logs/${prefix}-combined.log`,
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

// Add additional bots if .env files exist (legacy multi-env format)
const additionalEnvs = ['.env.account2', '.env.account3'];
additionalEnvs.forEach((envFile, index) => {
  if (fs.existsSync(path.join(__dirname, envFile))) {
    apps.push(createBotConfig(envFile, `standx-maker-bot-${index + 2}`));
  }
});

module.exports = {
  apps,
  // Display detected runtime
  __meta: {
    runtime: useBun ? `Bun (${bunPath})` : 'Node.js (fallback)',
    note: 'Bun is automatically detected when bun.lockb exists and bun command is available'
  }
};
