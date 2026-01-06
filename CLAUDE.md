# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **StandX Maker Points Farming Bot** that automatically places limit orders to earn maker points on the StandX perpetual futures DEX. The bot is designed to never hold positions - if an order is filled, it immediately closes the position with a market order.

**Key Features:**
- Automatic limit order placement on both sides of the order book
- Real-time mark price monitoring via WebSocket
- Dynamic order replacement when price moves within threshold
- Instant position closure on fills
- Telegram notifications
- TUI dashboard for monitoring
- Zero position tolerance (risk management)

## Commands

### Development
```bash
# Install dependencies
npm install

# Run in development mode with auto-reload
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

### Configuration
Edit `.env` file with your credentials:
- `STANDX_WALLET_PRIVATE_KEY`: Your Ethereum wallet private key
- `STANDX_WALLET_ADDRESS`: Your wallet address
- `TRADING_SYMBOL`: Trading pair (default: BTC-PERP)
- `TRADING_MODE`: both, buy, or sell
- `TRADING_ORDER_SIZE_BTC`: Order size in BTC
- `TRADING_ORDER_DISTANCE_BP`: Distance from mark price in basis points (default: 20bp = 0.2%)
- `TRADING_CANCEL_THRESHOLD_BP`: Cancel threshold in basis points (default: 10bp = 0.1%)

### TUI Controls
- `q`: Quit the bot
- `s`: Stop/start toggle
- `c`: Cancel all orders

## Architecture

### Core Components

**`src/bot/maker-points-bot.ts`** - Main bot logic
- Orchestrates the entire trading flow
- Manages bot state (orders, position, stats)
- Handles WebSocket events (mark price, order updates, position updates)
- Implements the core strategy:
  1. Place orders at ±N bp from mark price
  2. Monitor mark price in real-time
  3. Cancel and replace orders if mark price enters threshold
  4. Immediately close positions if orders are filled

**`src/bot/order-manager.ts`** - Order lifecycle management
- Calculates order prices based on mark price and distance
- Places limit orders and market orders (for closing)
- Cancels orders
- Waits for order fills
- Rounds prices to tick size

**`src/api/standx-client.ts`** - REST API client
- Handles all HTTP requests to StandX
- Methods: `placeOrder()`, `cancelOrder()`, `getOrderInfo()`, `getPosition()`, `fetchBBOPrices()`
- Manages JWT authentication and request signing

**`src/api/standx-websocket.ts`** - WebSocket client
- Connects to Market Stream and Order Response Stream
- Subscribes to: `symbol_price`, `user_orders`, `user_position`
- Emits events: `mark_price`, `order_update`, `position_update`
- Auto-reconnect with exponential backoff

**`src/api/standx-auth.ts`** - Authentication
- Generates Ed25519 key pair for request signing
- Performs JWT login flow
- Signs requests with Ed25519 private key

**`src/ui/tui.ts`** - Terminal UI
- Real-time dashboard using blessed
- Displays: status, orders, statistics, trades, logs
- Interactive controls (quit, stop/start, cancel)

**`src/notify/telegram.ts`** - Telegram notifications
- Sends alerts on: startup, shutdown, order fills, errors
- Status updates every hour

### Data Flow

1. **Initialization**
   - Load config from .env
   - Initialize StandX auth (Ed25519 + JWT)
   - Connect WebSocket streams
   - Subscribe to channels
   - Ensure zero starting position
   - Place initial orders

2. **Runtime Loop (Event-driven)**
   ```
   WebSocket mark_price update
   → Bot.handleMarkPriceUpdate()
   → Check if orders need replacement (within threshold)
   → If yes: cancel old order, place new order
   → Update TUI
   ```

   ```
   WebSocket order update (FILLED)
   → Bot.handleOrderFilled()
   → Immediately close position with market order
   → Send Telegram notification
   → Replace the filled order
   → Update statistics
   ```

3. **Exception Handling**
   - WebSocket disconnect: cancel all orders, reconnect with backoff
   - Close position failure: stop bot, send emergency Telegram alert
   - API errors: log and retry

### Key Trading Logic

**Order Price Calculation:**
```typescript
buy_price = mark_price * (1 - distance_bp/10000)
sell_price = mark_price * (1 + distance_bp/10000)
```

**Cancel Threshold:**
```typescript
if abs(mark_price - order_price) / order_price <= cancel_threshold_bp/10000:
    cancel_and_replace_order()
```

**Position Closure:**
- Uses aggressive market order (beyond best bid/ask)
- For long: sell at 0.999 * best_bid
- For short: buy at 1.001 * best_ask
- Timeout: 10 seconds
- If fails: emergency stop

## Important Implementation Details

### StandX API Specifics

**Authentication Flow:**
1. Generate Ed25519 key pair
2. POST `/v1/offchain/prepare-signin` with requestId (Base58 public key)
3. Sign the JWT's message field with Ethereum private key
4. POST `/v1/offchain/login` to get JWT token (7 days valid)
5. Sign all POST requests with: `version,requestId,timestamp,payload`

**WebSocket Channels:**
- Market Stream: `wss://perps.standx.com/ws-stream/v1`
- Order Response Stream: `wss://perps.standx.com/ws-api/v1`
- Subscribe to: `symbol_price`, `user_orders`, `user_position`

**Order Management:**
- Orders are placed with `cl_ord_id` (client order ID)
- API returns real `order_id` after placement
- Use `cl_ord_id` to track, but need real `order_id` to cancel
- `place_close_order()` or `place_order()` with `reduce_only=true` for closing

### Risk Management

**Core Principle:** Zero tolerance for positions
- Any order fill triggers immediate market close
- If close fails → stop bot immediately
- Manual intervention required

**Price Protection:**
- Orders placed at ±20bp (default) from mark price
- Cancel when mark price enters ±10bp range
- This prevents fills while maximizing points earning

### State Management

**BotState includes:**
- `isRunning`: Boolean flag
- `markPrice`: Current mark price from WebSocket
- `position`: Current position size
- `buyOrder`, `sellOrder`: Active order info
- `stats`: Orders placed/canceled/filled counts

All state updates emit events for TUI to consume.

## Testing Strategy

**Unit tests** (not yet implemented):
- Price calculation accuracy
- Threshold checking logic
- Rounding to tick size

**Integration testing:**
- Use testnet or paper trading
- Test order lifecycle: place → fill → close
- Test WebSocket reconnection
- Test failure scenarios

## Debugging

**Enable debug logging:**
```bash
LOG_LEVEL=debug npm run dev
```

**Check logs:**
```bash
tail -f logs/bot-YYYY-MM-DD.log
```

**Common issues:**
- Authentication fails: Check private key matches address
- WebSocket disconnects: Check network, firewall
- Orders not placing: Check account balance, order size minimums
- Position closure fails: Emergency stop, check manually

## Modifications

When modifying the bot, keep these principles in mind:

1. **Never allow holding positions** - All trades must be immediately hedged/closed
2. **Fail-safe** - Any error should stop trading and alert user
3. **State consistency** - Ensure WebSocket updates match REST API queries
4. **Atomic operations** - Either complete entire trade cycle or rollback
5. **Log everything** - All state changes must be logged

## StandX Documentation Sources

- [StandX Perps WebSocket API](https://docs.standx.com/standx-api/perps-ws)
- [StandX API Documentation](https://docs.standx.com/standx-api/standx-api)
- [Maker Points Campaign](https://docs.standx.com/docs/stand-x-campaigns/mainnet-campaigns)
- [Market Making Program](https://docs.standx.com/docs/stand-x-campaigns/stand-x-market-making-program)
