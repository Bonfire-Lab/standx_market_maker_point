#!/bin/bash

# StandX Maker Bot - Stop Script
# This script stops the bot running under PM2

set -e

echo "🛑 Stopping StandX Maker Bot..."

# Check if bot is running
if pm2 describe standx-maker-bot > /dev/null 2>&1; then
    # Stop the bot
    pm2 stop standx-maker-bot

    echo "✅ Bot stopped successfully!"
    echo ""
    echo "To start it again, run: ./start.sh"
else
    echo "⚠️  Bot is not currently running"
fi
