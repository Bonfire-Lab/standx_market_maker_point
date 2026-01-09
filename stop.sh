#!/bin/bash

# StandX Maker Bot - Stop Script
# This script stops all bot instances running under PM2

set -e

echo "🛑 Stopping StandX Maker Bots..."
echo ""

# Stop all standx-maker-bot instances
pm2 stop standx-maker-bot standx-maker-bot-2 standx-maker-bot-3 2>/dev/null || true

echo "✅ All bots stopped!"
echo ""
echo "To start them again, run: ./start.sh"
