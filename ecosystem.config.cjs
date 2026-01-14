const fs = require('fs');
const path = require('path');

// Try to find Bun in common paths
function findBunPath() {
  const { execSync } = require('child_process');
  const os = require('os');

  const homeDir = os.homedir();
  const paths = [
    // Try 'which bun' first
    () => {
      try { return execSync('which bun', { encoding: 'utf8' }).trim(); } catch { return null; }
    },
    // Then common paths
    () => {
      const p = path.join(homeDir, '.bun', 'bin', 'bun');
      return fs.existsSync(p) ? p : null;
    },
    () => {
      const p = path.join(homeDir, '.local', 'bin', 'bun');
      return fs.existsSync(p) ? p : null;
    },
    () => fs.existsSync('/usr/local/bin/bun') ? '/usr/local/bin/bun' : null,
    () => fs.existsSync('/usr/bin/bun') ? '/usr/bin/bun' : null,
  ];

  for (const fn of paths) {
    const result = fn();
    if (result) return result;
  }
  return null;
}

const bunPath = findBunPath();
const useBun = bunPath !== null;

function getLogFilePrefix(envFile) {
  if (envFile === '.env') return 'main';
  return envFile.replace('.env.', '').replace('.env', '');
}

function createBotConfig(envFile, appName) {
  const prefix = getLogFilePrefix(envFile);

  if (useBun) {
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

  // Node.js fallback - requires built dist/index.js
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

const apps = [createBotConfig('.env', 'standx-maker-bot')];

module.exports = {
  apps
};
