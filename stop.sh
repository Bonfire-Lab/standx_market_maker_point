#!/bin/bash

# StandX Maker Bot - Stop Script
# This script stops the standx-maker-bot process only

echo "🛑 Stopping StandX Maker Bot..."
echo ""

# Stop the bot if it exists
if pm2 list | grep -q "standx-maker-bot"; then
  pm2 delete standx-maker-bot 2>/dev/null || pm2 stop standx-maker-bot 2>/dev/null || true
  echo "✅ Stopped standx-maker-bot"
else
  echo "⚠️  No standx-maker-bot process found"
fi

echo ""
echo "==========================================="
pm2 list | grep -E "standx-maker-bot|online" || echo "No bots in PM2"
echo ""
echo "Useful commands:"
echo "  Start:       ./start.sh"
echo "  View logs:   pm2 logs"
echo ""
