#!/bin/bash

# StandX Maker Bot - Start Script
# This script starts the bot using PM2 process manager
# Supports multiple accounts via .env.account2, .env.account3, etc.

set -e

# Change to the script's directory
cd "$(dirname "$0")"

echo "🚀 Starting StandX Maker Bot..."
echo "Working directory: $(pwd)"
echo ""

# Function to start a bot instance
start_bot() {
  local env_file=$1
  local app_name=$2

  if [ -f "$env_file" ]; then
    echo "📦 Starting bot with: $env_file"

    # Get absolute path of env file
    local env_path="$(pwd)/$env_file"
    local log_name="$(basename $env_file .env)"

    pm2 start ./src/index.ts \
      --name "$app_name" \
      --interpreter "npx tsx" \
      --env ENV_FILE="$env_path" \
      -e "./logs/${log_name}-error.log" \
      -o "./logs/${log_name}-out.log" \
      -l "./logs/${log_name}-combined.log" \
      --time \
      --merge-logs \
      --autorestart \
      --max-restarts 10 \
      --min-uptime 10000 \
      --restart-delay 4000

    echo "✅ Started: $app_name"
    echo ""
  else
    echo "⚠️  Skipped: $env_file (not found)"
  fi
}

# Start primary bot (default .env)
if [ -f ".env" ]; then
  start_bot ".env" "standx-maker-bot"
else
  echo "❌ Error: .env file not found!"
  exit 1
fi

# Start additional bots if env files exist
start_bot ".env.account2" "standx-maker-bot-2"
start_bot ".env.account3" "standx-maker-bot-3"

# Wait a moment for the bots to start
sleep 2

# Show status
pm2 status

echo ""
echo "==========================================="
echo "Summary:"
echo "==========================================="
pm2 list | grep standx || echo "No bots running"
echo ""
echo "Useful commands:"
echo "  View all logs:  pm2 logs"
echo "  View specific:  pm2 logs standx-maker-bot"
echo "  Monitor:        pm2 monit"
echo "  Stop all:       ./stop.sh"
echo "  Stop specific:  pm2 stop standx-maker-bot-2"
echo "  Restart:        pm2 restart standx-maker-bot"
