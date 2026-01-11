#!/bin/bash

# StandX Maker Bot - Stop Script
# This script stops all bot instances running under PM2

echo "🛑 Stopping StandX Maker Bots..."
echo ""

# Dynamically find and stop all standx-maker-bot instances
# Use node to parse JSON from pm2 jlist
BOT_IDS=$(node -e "
  const data = require('child_process').execSync('pm2 jlist', { encoding: 'utf8' });
  const procs = JSON.parse(data);
  procs
    .filter(p => p.name && p.name.startsWith('standx-maker-bot'))
    .forEach(p => console.log(p.pm_id));
" 2>/dev/null)

if [ -z "$BOT_IDS" ]; then
  echo "⚠️  No running bots found"
else
  for id in $BOT_IDS; do
    pm2 stop $id 2>/dev/null || true
  done
  echo "✅ Stopped all standx-maker-bot instances"
fi

echo ""
echo "==========================================="
pm2 list | grep -E "standx-maker-bot" || echo "No bots in PM2"
echo ""
echo "Useful commands:"
echo "  Start all:       ./start.sh"
echo "  Delete all:      pm2 delete all"
echo "  View logs:       pm2 logs"
