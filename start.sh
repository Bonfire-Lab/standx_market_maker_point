#!/bin/bash

# StandX Maker Bot - Start Script
# This script starts the bot using PM2 process manager
# Supports multiple accounts via .env.account2, .env.account3

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

# Start all configured bots from ecosystem.config.js
pm2 start ecosystem.config.js

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
