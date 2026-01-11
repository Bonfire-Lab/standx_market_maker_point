#!/bin/bash

# StandX Maker Bot - Stop Script
# This script stops all bot instances running under PM2

echo "🛑 Stopping StandX Maker Bots..."
echo ""

# Stop all standx-maker-bot instances (main, account2, account3, etc.)
pm2 stop standx-maker-bot 2>/dev/null || true
pm2 stop standx-maker-bot-2 2>/dev/null || true
pm2 stop standx-maker-bot-3 2>/dev/null || true

echo ""
echo "==========================================="
pm2 list | grep -E "standx-maker-bot" || echo "No bots in PM2"
echo ""
echo "✅ Done!"
echo ""
echo "Useful commands:"
echo "  Start all:       ./start.sh"
echo "  Delete all:      pm2 delete all"
echo "  View logs:       pm2 logs"
echo "  Start specific:  pm2 start standx-maker-bot-2"
