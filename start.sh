#!/bin/bash

# StandX Maker Bot - Start Script
# This script starts the bot using PM2 process manager with Bun

set -e

# Change to the script's directory
cd "$(dirname "$0")"

echo "🚀 Starting StandX Maker Bot..."
echo "Working directory: $(pwd)"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
  echo "❌ Error: .env file not found!"
  exit 1
fi

# Find Bun path
if [ -n "$BUN_PATH" ]; then
  BUN_BIN="$BUN_PATH"
elif command -v bun &> /dev/null; then
  BUN_BIN="$(command -v bun)"
else
  # Try common installation paths
  HOME_BUN="$HOME/.bun/bin/bun"
  if [ -f "$HOME_BUN" ]; then
    BUN_BIN="$HOME_BUN"
  else
    echo "❌ Error: Bun not found!"
    echo "   Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi

echo "Runtime: Bun"
echo "Bun path: $BUN_BIN"
echo ""

# Check if bot is already running, delete it first
if pm2 list | grep -q "standx-maker-bot.*online"; then
  echo "Stopping existing bot..."
  pm2 delete standx-maker-bot 2>/dev/null || true
  sleep 1
fi

# Start with Bun directly
pm2 start "$BUN_BIN" --name standx-maker-bot -- src/index.ts

# Wait a moment for the bot to start
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
echo "  Stop:           pm2 stop standx-maker-bot"
echo "  Restart:        pm2 restart standx-maker-bot"
echo "  Save config:    pm2 save"
echo ""
