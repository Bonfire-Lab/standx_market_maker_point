import Decimal from 'decimal.js';
import { EventEmitter } from 'eventemitter3';
import { StandXAuth } from '../api/standx-auth';
import { StandXClient } from '../api/standx-client';
import { StandXWebSocket } from '../api/standx-websocket';
import { OrderManager } from './order-manager';
import { telegram } from '../notify/telegram';
import { log, createAccountLogger } from '../utils/logger';
import { getConfig } from '../config';
import { BotState, BotStats, TradingMode, OrderSide, WSMarkPriceData, WSOrderData, AccountConfig } from '../types';

/**
 * StandX Maker Points Bot
 * Main bot logic for farming maker points
 */
export class MakerPointsBot extends EventEmitter {
  private auth: StandXAuth;
  private client: StandXClient;
  private ws: StandXWebSocket;
  private orderManager: OrderManager;
  private config = getConfig();
  private account: AccountConfig;
  private logger: ReturnType<typeof createAccountLogger>;
  private accountId: string;

  // Bot state
  private state: BotState;
  private markPrice: Decimal = Decimal(0);
  private lastPrice: Decimal | null = null;   // Latest trade price from WS
  private spreadBid: Decimal | null = null;   // Best bid from WS
  private spreadAsk: Decimal | null = null;   // Best ask from WS
  private stopRequested: boolean = false;
  private startTime: number;
  private isProcessingFill: boolean = false;  // Flag to prevent race conditions during fill processing
  private isPausedDueToVolatility: boolean = false;  // Paused due to high last-mark gap

  constructor(account: AccountConfig) {
    super();

    this.account = account;
    this.accountId = account.name;
    this.logger = createAccountLogger(account);

    // Initialize auth (new API: no constructor params, login via loginWithPrivateKey)
    this.auth = new StandXAuth();

    // Initialize clients
    this.client = new StandXClient(this.auth);
    this.ws = new StandXWebSocket(this.auth);
    this.orderManager = new OrderManager(this.client, this.config.trading.symbol);

    // Initialize state
    this.startTime = Date.now();
    this.state = {
      isRunning: false,
      markPrice: Decimal(0),
      position: Decimal(0),
      buyOrder: null,
      sellOrder: null,
      stats: {
        ordersPlaced: 0,
        ordersCanceled: 0,
        ordersFilled: 0,
        startTime: this.startTime
      }
    };
  }

  /**
   * Get account ID
   */
  getAccountId(): string {
    return this.accountId;
  }

  /**
   * Get account config
   */
  getAccount(): AccountConfig {
    return this.account;
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Starting StandX Maker Points Bot...');
      this.stopRequested = false;

      // Authenticate first (new API: loginWithPrivateKey)
      this.logger.info('Authenticating...');
      await this.auth.loginWithPrivateKey(
        this.account.privateKey,
        this.account.chain
      );
      this.logger.info('✅ Authenticated');

      // Initialize client
      this.logger.info(`Initializing for ${this.config.trading.symbol}...`);
      await this.client.initialize(this.config.trading.symbol);
      this.logger.info(`✅ Initialized for ${this.config.trading.symbol}`);

      // Connect WebSocket
      this.logger.info('Connecting to WebSocket...');
      await this.ws.connect();
      this.logger.info('✅ WebSocket connected');

      // Subscribe to channels
      this.logger.info('Subscribing to channels...');
      this.ws.subscribeMarkPrice([this.config.trading.symbol]);
      this.ws.subscribeUserStreams();

      // Setup WebSocket event handlers
      this.setupWebSocketHandlers();

      // Wait for initial mark price from WebSocket
      this.logger.info('Waiting for initial mark price from WebSocket...');
      await this.waitForMarkPrice();

      // Check and close any existing position
      this.logger.info('Checking existing positions...');
      await this.ensureZeroPosition();

      // Set state to running
      this.state.isRunning = true;
      this.emit('state_changed', this.state);

      // Place initial orders
      this.logger.info('Placing initial orders...');
      await this.placeInitialOrders();

      // Send startup notification
      if (telegram.isEnabled()) {
        await telegram.startup();
      }

      this.logger.info('✅ Bot started successfully');
      this.emit('started');

    } catch (error: any) {
      this.logger.error(`Failed to start bot: ${error.message}`);
      console.error('Stack trace:', error.stack);
      await telegram.error(`Bot startup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    try {
      this.logger.info('🛑 Stopping bot...');
      this.stopRequested = true;
      this.state.isRunning = false;

      // Cancel all orders
      await this.orderManager.cancelAllOrders();

      // Disconnect WebSocket
      this.ws.disconnect();

      // Send shutdown notification
      if (telegram.isEnabled()) {
        await telegram.shutdown();
      }

      this.logger.info('✅ Bot stopped');
      this.emit('stopped');

    } catch (error: any) {
      this.logger.error(`Error stopping bot: ${error.message}`);
    }
  }

  /**
   * Wait for initial mark price to be set
   */
  private async waitForMarkPrice(): Promise<void> {
    const maxWait = 10; // seconds
    const start = Date.now();

    while (this.markPrice.eq(0)) {
      if (Date.now() - start > maxWait * 1000) {
        throw new Error('Timeout waiting for mark price');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.logger.info(`✅ Initial mark price: $${this.markPrice.toFixed(2)}`);
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    // Mark price updates
    this.ws.on('mark_price', (data: WSMarkPriceData) => {
      this.handleMarkPriceUpdate(data);
    });

    // Order updates
    this.ws.on('order_update', (data: WSOrderData) => {
      this.handleOrderUpdate(data);
    });

    // Position updates
    this.ws.on('position_update', (data: any) => {
      this.handlePositionUpdate(data);
    });

    // Reconnection events
    this.ws.on('reconnecting', (info: any) => {
      this.logger.warn(`WebSocket reconnecting (attempt ${info.attempt})`);
      telegram.warning(`WebSocket reconnecting... (attempt ${info.attempt})`);
    });

    this.ws.on('market_reconnected', () => {
      this.logger.info('✅ Market WebSocket reconnected');
      telegram.info('Market WebSocket reconnected');
      // Resubscribe
      this.ws.subscribeMarkPrice([this.config.trading.symbol]);
      this.ws.subscribeUserStreams();
      // Restore orders
      this.placeInitialOrders();
    });
  }

  /**
   * Handle mark price updates
   */
  private async handleMarkPriceUpdate(data: WSMarkPriceData): Promise<void> {
    try {
      const markPrice = new Decimal(data.markPrice);
      this.markPrice = markPrice;
      this.state.markPrice = markPrice;

      // Update last price and spread from WS data
      if (data.lastPrice) {
        this.lastPrice = new Decimal(data.lastPrice);
      }
      if (data.spread && Array.isArray(data.spread) && data.spread.length >= 2) {
        this.spreadBid = new Decimal(data.spread[0]);
        this.spreadAsk = new Decimal(data.spread[1]);
      }

      this.logger.debug(`Mark price updated: $${markPrice.toFixed(2)}`);
      if (this.lastPrice) {
        const gapBp = this.lastPrice.sub(markPrice).abs().div(markPrice).mul(10000);
        this.logger.debug(`Last-mark gap: ${gapBp.toFixed(2)} bp (mark: ${markPrice.toFixed(2)}, last: ${this.lastPrice.toFixed(2)})`);
      }

      // Check if we need to cancel and replace orders
      await this.checkAndReplaceOrders();

    } catch (error: any) {
      this.logger.error(`Error handling mark price update: ${error.message}`);
    }
  }

  /**
   * Handle order updates
   */
  private async handleOrderUpdate(data: WSOrderData): Promise<void> {
    try {
      const orderId = data.clientOrderId || data.orderId.toString();
      const status = data.status;

      this.logger.debug(`Order update: ${orderId} - ${status}`);

      // Update our order tracking
      if (this.state.buyOrder && this.state.buyOrder.orderId === orderId) {
        this.state.buyOrder.status = status;
        this.state.buyOrder.filledQty = new Decimal(data.fillQty);
      }

      if (this.state.sellOrder && this.state.sellOrder.orderId === orderId) {
        this.state.sellOrder.status = status;
        this.state.sellOrder.filledQty = new Decimal(data.fillQty);
      }

      // Check if order was filled
      if (status === 'FILLED') {
        await this.handleOrderFilled(data);
      }

      this.emit('order_updated', this.state);

    } catch (error: any) {
      this.logger.error(`Error handling order update: ${error.message}`);
    }
  }

  /**
   * Handle position updates
   */
  private async handlePositionUpdate(data: any): Promise<void> {
    try {
      const position = new Decimal(data.positionAmt || data.qty || 0);
      const previousPosition = this.state.position;
      this.state.position = position;

      this.logger.debug(`Position updated: ${previousPosition} → ${position} BTC`);

      // Check if position changed from zero (an order was filled)
      if (previousPosition.abs().lt(new Decimal('0.00001')) && position.abs().gte(new Decimal('0.00001'))) {
        this.logger.warn(`⚠️⚠️⚠️ POSITION DETECTED VIA WEBSOCKET ⚠️⚠️⚠️`);
        this.logger.warn(`  Previous: ${previousPosition} BTC`);
        this.logger.warn(`  Current: ${position} BTC`);

        // Close position immediately
        await this.closeDetectedPosition(position);
      }

      // Emit event
      this.emit('position_updated', position);

    } catch (error: any) {
      this.logger.error(`Error handling position update: ${error.message}`);
    }
  }

  /**
   * Close detected position immediately
   */
  private async closeDetectedPosition(position: Decimal): Promise<void> {
    try {
      const positionSize = position.abs();
      const closeSide = position.gt(0) ? 'sell' : 'buy';

      this.logger.warn(`🔄 Closing position via market order...`);
      this.logger.warn(`  Size: ${positionSize} BTC`);
      this.logger.warn(`  Side: ${closeSide}`);

      // Cancel all pending orders first
      await this.orderManager.cancelAllOrders();

      // Close position with market order
      const closed = await this.orderManager.closePosition(positionSize, closeSide);

      if (!closed) {
        this.logger.error('❌ Failed to close position!');
        await telegram.error('Failed to close position! Manual intervention required!');
        // Stop the bot to prevent further damage
        await this.stop();
        return;
      }

      this.logger.warn(`✅ Position closed successfully`);

      // Update position back to zero
      this.state.position = Decimal(0);

      // Wait a moment before placing new orders
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Replace orders
      this.logger.warn(`🔄 Replacing orders...`);
      await this.placeInitialOrders();

      // Send notification
      if (telegram.isEnabled()) {
        await telegram.warning('Position detected and closed via market order');
      }

    } catch (error: any) {
      this.logger.error(`Error closing detected position: ${error.message}`);
      await telegram.error(`Error closing position: ${error.message}`);
      await this.stop();
    }
  }

  /**
   * Place initial orders
   */
  private async placeInitialOrders(): Promise<void> {
    try {
      const mode = this.config.trading.mode;

      // Cancel any existing orders
      await this.orderManager.cancelAllOrders();

      // Place orders based on mode
      if (mode === 'both' || mode === 'buy') {
        const buyPrice = this.orderManager.calculateOrderPrice(
          'buy',
          this.markPrice,
          this.config.trading.orderDistanceBp
        );

        const buyOrder = await this.orderManager.placeOrder(
          'buy',
          new Decimal(this.config.trading.orderSizeBtc),
          buyPrice
        );

        if (buyOrder) {
          this.state.buyOrder = buyOrder;
          this.state.stats.ordersPlaced++;
        }
      }

      if (mode === 'both' || mode === 'sell') {
        const sellPrice = this.orderManager.calculateOrderPrice(
          'sell',
          this.markPrice,
          this.config.trading.orderDistanceBp
        );

        const sellOrder = await this.orderManager.placeOrder(
          'sell',
          new Decimal(this.config.trading.orderSizeBtc),
          sellPrice
        );

        if (sellOrder) {
          this.state.sellOrder = sellOrder;
          this.state.stats.ordersPlaced++;
        }
      }

      this.emit('orders_placed', this.state);
      this.logger.info('✅ Initial orders placed');

    } catch (error: any) {
      this.logger.error(`Error placing initial orders: ${error.message}`);
    }
  }

  /**
   * Check and replace orders if mark price is outside valid range
   */
  private async checkAndReplaceOrders(): Promise<void> {
    if (!this.state.isRunning || this.stopRequested) {
      return;
    }

    if (this.markPrice.eq(0)) {
      return;
    }

    // Skip if we're currently processing a fill to prevent race conditions
    if (this.isProcessingFill) {
      this.logger.debug('Skipping checkAndReplaceOrders - fill processing in progress');
      return;
    }

    try {
      // SAFETY CHECK: Verify position is zero
      const currentPosition = await this.orderManager.getCurrentPosition();
      if (currentPosition.abs().gte(new Decimal('0.00001'))) {
        this.logger.error(`⚠️⚠️⚠️ NON-ZERO POSITION DETECTED IN CHECK LOOP ⚠️⚠️⚠️`);
        this.logger.error(`  Position: ${currentPosition} BTC`);
        await this.closeDetectedPosition(currentPosition);
        return;
      }

      const minDistanceBp = this.config.trading.minDistanceBp;
      const maxDistanceBp = this.config.trading.maxDistanceBp;
      const orderDistanceBp = this.config.trading.orderDistanceBp;

      // === NEW CHECK 1: Last-Mark Gap Detection ===
      // If last price is too far from mark, market is volatile - pause ordering
      if (this.lastPrice) {
        const lastMarkGapBp = this.lastPrice.sub(this.markPrice).abs().div(this.markPrice).mul(10000);

        if (lastMarkGapBp.gt(orderDistanceBp)) {
          if (!this.isPausedDueToVolatility) {
            // First time detecting high volatility
            this.logger.warn(`⚠️ HIGH VOLATILITY DETECTED: last-mark gap = ${lastMarkGapBp.toFixed(2)} bp > ${orderDistanceBp} bp`);
            this.logger.warn(`  Mark: $${this.markPrice.toFixed(2)}, Last: $${this.lastPrice.toFixed(2)}`);
            this.logger.warn(`  Canceling all orders and pausing until market stabilizes...`);

            this.isPausedDueToVolatility = true;
            await this.orderManager.cancelAllOrders();
            this.state.buyOrder = null;
            this.state.sellOrder = null;

            telegram.warning(`⚠️ High volatility detected (last-mark gap: ${lastMarkGapBp.toFixed(2)} bp). Pausing orders.`);
          }
          // Skip all order checks while paused
          return;
        } else {
          // Volatility has subsided
          if (this.isPausedDueToVolatility && lastMarkGapBp.lt(new Decimal(orderDistanceBp).mul(0.8))) {
            // Only resume when gap is below 80% of threshold (hysteresis)
            this.logger.info(`✅ Volatility normalized. Gap: ${lastMarkGapBp.toFixed(2)} bp. Resuming orders...`);
            this.isPausedDueToVolatility = false;

            // Place orders to resume trading
            const mode = this.config.trading.mode;
            if (mode === 'both' || mode === 'buy') {
              const buyPrice = this.orderManager.calculateOrderPrice(
                'buy',
                this.markPrice,
                this.config.trading.orderDistanceBp
              );
              const buyOrder = await this.orderManager.placeOrder(
                'buy',
                new Decimal(this.config.trading.orderSizeBtc),
                buyPrice
              );
              if (buyOrder) {
                this.state.buyOrder = buyOrder;
                this.state.stats.ordersPlaced++;
                this.logger.info(`[BUY] Order placed after resuming: ${buyOrder.orderId} @ $${buyOrder.price.toFixed(2)}`);
              }
            }
            if (mode === 'both' || mode === 'sell') {
              const sellPrice = this.orderManager.calculateOrderPrice(
                'sell',
                this.markPrice,
                this.config.trading.orderDistanceBp
              );
              const sellOrder = await this.orderManager.placeOrder(
                'sell',
                new Decimal(this.config.trading.orderSizeBtc),
                sellPrice
              );
              if (sellOrder) {
                this.state.sellOrder = sellOrder;
                this.state.stats.ordersPlaced++;
                this.logger.info(`[SELL] Order placed after resuming: ${sellOrder.orderId} @ $${sellOrder.price.toFixed(2)}`);
              }
            }

            telegram.info(`✅ Volatility normalized. Resuming orders.`);
          } else if (this.isPausedDueToVolatility) {
            // Still paused
            this.logger.debug(`Still paused due to volatility. Gap: ${lastMarkGapBp.toFixed(2)} bp`);
            return;
          }
        }
      }

      // === NEW CHECK 2: Spread Validation ===
      // Ensure orders are not inside the spread (would get filled immediately)
      if (this.spreadBid && this.spreadAsk) {
        // Check buy order
        if (this.state.buyOrder && this.state.buyOrder.status === 'OPEN') {
          const buyPrice = this.state.buyOrder.price;
          if (buyPrice.gte(this.spreadBid)) {
            this.logger.warn(`[BUY] Order inside spread! Buy: ${buyPrice.toFixed(2)} >= Bid: ${this.spreadBid.toFixed(2)}`);
            this.logger.warn(`  Canceling and replacing...`);
            await this.replaceOrder('buy');
            return;  // Exit after replace, will recheck on next update
          }
        }
        // Check sell order
        if (this.state.sellOrder && this.state.sellOrder.status === 'OPEN') {
          const sellPrice = this.state.sellOrder.price;
          if (sellPrice.lte(this.spreadAsk)) {
            this.logger.warn(`[SELL] Order inside spread! Sell: ${sellPrice.toFixed(2)} <= Ask: ${this.spreadAsk.toFixed(2)}`);
            this.logger.warn(`  Canceling and replacing...`);
            await this.replaceOrder('sell');
            return;  // Exit after replace, will recheck on next update
          }
        }
      }

      // === EXISTING CHECK: Mark Price Distance ===
      // Check buy order
      if (this.state.buyOrder && this.state.buyOrder.status === 'OPEN') {
        const distance = this.markPrice
          .minus(this.state.buyOrder.price)
          .abs()
          .div(this.state.buyOrder.price)
          .mul(10000);

        // Replace if too close (risk of fill) or too far (no points)
        if (distance.lt(new Decimal(minDistanceBp))) {
          this.logger.info(`[BUY] Too close to mark price (${distance.toFixed(2)} bp < ${minDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('buy');
        } else if (distance.gt(new Decimal(maxDistanceBp))) {
          this.logger.info(`[BUY] Too far from mark price (${distance.toFixed(2)} bp > ${maxDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('buy');
        } else {
          this.logger.debug(`[BUY] Order in valid range: ${distance.toFixed(2)} bp [${minDistanceBp}-${maxDistanceBp} bp]`);
        }
      }

      // Check sell order
      if (this.state.sellOrder && this.state.sellOrder.status === 'OPEN') {
        const distance = this.markPrice
          .minus(this.state.sellOrder.price)
          .abs()
          .div(this.state.sellOrder.price)
          .mul(10000);

        // Replace if too close (risk of fill) or too far (no points)
        if (distance.lt(new Decimal(minDistanceBp))) {
          this.logger.info(`[SELL] Too close to mark price (${distance.toFixed(2)} bp < ${minDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('sell');
        } else if (distance.gt(new Decimal(maxDistanceBp))) {
          this.logger.info(`[SELL] Too far from mark price (${distance.toFixed(2)} bp > ${maxDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('sell');
        } else {
          this.logger.debug(`[SELL] Order in valid range: ${distance.toFixed(2)} bp [${minDistanceBp}-${maxDistanceBp} bp]`);
        }
      }

    } catch (error: any) {
      this.logger.error(`Error in check and replace: ${error.message}`);
    }
  }

  /**
   * Replace an order
   * @param side Order side to replace
   * @param useFreshPrice If true, fetch fresh mark price via REST API before replacing
   */
  private async replaceOrder(side: OrderSide, useFreshPrice: boolean = false): Promise<void> {
    try {
      const order = side === 'buy' ? this.state.buyOrder : this.state.sellOrder;

      if (!order) {
        // This can happen when the order was cleared during fill processing
        // Just place a new order instead of replacing
        this.logger.info(`[${side.toUpperCase()}] No existing order to replace, placing new order...`);

        if (useFreshPrice) {
          const freshPrice = await this.client.getMarkPrice(this.config.trading.symbol);
          this.logger.info(`[${side.toUpperCase()}] Fresh mark price: $${freshPrice.toFixed(2)}`);
          this.markPrice = freshPrice;
          this.state.markPrice = freshPrice;
        }

        const newPrice = this.orderManager.calculateOrderPrice(
          side,
          this.markPrice,
          this.config.trading.orderDistanceBp
        );

        const newOrder = await this.orderManager.placeOrder(
          side,
          new Decimal(this.config.trading.orderSizeBtc),
          newPrice
        );

        if (newOrder) {
          if (side === 'buy') {
            this.state.buyOrder = newOrder;
          } else {
            this.state.sellOrder = newOrder;
          }
          this.state.stats.ordersPlaced++;
          this.logger.info(`[${side.toUpperCase()}] New order placed: ${newOrder.orderId} @ $${newOrder.price.toFixed(2)}`);
        }
        return;
      }

      // If useFreshPrice is true, fetch current mark price via REST API
      // This is important after fills to ensure we use the latest price
      let priceForCalc = this.markPrice;
      if (useFreshPrice) {
        try {
          const freshPrice = await this.client.getMarkPrice(this.config.trading.symbol);
          this.logger.info(`[${side.toUpperCase()}] Fresh mark price: $${freshPrice.toFixed(2)} (cached: $${this.markPrice.toFixed(2)})`);
          priceForCalc = freshPrice;
          // Update cached mark price
          this.markPrice = freshPrice;
          this.state.markPrice = freshPrice;
        } catch (error: any) {
          this.logger.warn(`[${side.toUpperCase()}] Failed to fetch fresh mark price, using cached: ${error.message}`);
        }
      }

      this.logger.info(`[${side.toUpperCase()}] Current order: ${order.price.toFixed(2)} (Mark: ${priceForCalc.toFixed(2)})`);

      // Cancel existing order
      this.logger.info(`[${side.toUpperCase()}] Canceling order ${order.orderId}...`);
      const canceled = await this.orderManager.cancelOrder(order.orderId);

      if (canceled) {
        this.state.stats.ordersCanceled++;
        this.logger.info(`[${side.toUpperCase()}] Order canceled successfully`);
      } else {
        this.logger.warn(`[${side.toUpperCase()}] Order cancel failed (may already be filled)`);
      }

      // Calculate new price
      const newPrice = this.orderManager.calculateOrderPrice(
        side,
        priceForCalc,
        this.config.trading.orderDistanceBp
      );

      this.logger.info(`[${side.toUpperCase()}] New price: $${newPrice.toFixed(2)}`);

      // Place new order
      const newOrder = await this.orderManager.placeOrder(
        side,
        new Decimal(this.config.trading.orderSizeBtc),
        newPrice
      );

      if (newOrder) {
        if (side === 'buy') {
          this.state.buyOrder = newOrder;
        } else {
          this.state.sellOrder = newOrder;
        }
        this.state.stats.ordersPlaced++;
        this.logger.info(`[${side.toUpperCase()}] New order placed: ${newOrder.orderId} @ $${newOrder.price.toFixed(2)}`);
      }

      this.emit('order_replaced', { side, newOrder });
      this.logger.info(`✅ [${side.toUpperCase()}] Order replaced successfully`);

    } catch (error: any) {
      this.logger.error(`Error replacing ${side} order: ${error.message}`);
    }
  }

  /**
   * Handle order filled event
   */
  private async handleOrderFilled(data: WSOrderData): Promise<void> {
    // Prevent concurrent fill processing to avoid race conditions
    if (this.isProcessingFill) {
      this.logger.warn('⚠️ Fill already being processed, skipping duplicate event');
      return;
    }

    this.isProcessingFill = true;

    try {
      const side = data.side;
      const qty = new Decimal(data.fillQty);
      const price = new Decimal(data.avgFillPrice || data.price);
      const orderId = data.clientOrderId || data.orderId.toString();

      this.logger.warn(`⚠️⚠️⚠️ ORDER FILLED ⚠️⚠️⚠️`);
      this.logger.warn(`  Side: ${side.toUpperCase()}`);
      this.logger.warn(`  Qty: ${qty} BTC`);
      this.logger.warn(`  Price: $${price.toFixed(2)}`);
      this.logger.warn(`  Order ID: ${data.orderId}`);

      this.state.stats.ordersFilled++;
      this.state.stats.lastTradeTime = Date.now();

      // Update position
      if (side === 'buy') {
        this.state.position = this.state.position.plus(qty);
      } else {
        this.state.position = this.state.position.minus(qty);
      }

      this.logger.warn(`Current Position: ${this.state.position.toFixed(4)} BTC`);

      // Send Telegram notification
      if (telegram.isEnabled()) {
        await telegram.trade(side, qty.toString(), price.toFixed(2));
      }

      // Close position immediately
      this.logger.warn(`🔄 Closing position immediately...`);
      const closeSide = side === 'buy' ? 'sell' : 'buy';
      const closed = await this.orderManager.closePosition(qty, closeSide);

      if (!closed) {
        this.logger.error('❌ Failed to close position!');
        await telegram.error('Failed to close position!');
        // Stop the bot to prevent further damage
        await this.stop();
        return;
      }

      this.logger.warn(`✅ Position closed successfully`);

      // Update position back to zero
      this.state.position = Decimal(0);

      // Clear the filled order from state to prevent trying to replace it later
      // Also clear the opposite side since all orders should have been canceled before closing
      if (side === 'buy') {
        if (this.state.buyOrder && this.state.buyOrder.orderId === orderId) {
          this.logger.warn(`Clearing filled buy order from state: ${orderId}`);
          this.state.buyOrder = null;
        }
      } else {
        if (this.state.sellOrder && this.state.sellOrder.orderId === orderId) {
          this.logger.warn(`Clearing filled sell order from state: ${orderId}`);
          this.state.sellOrder = null;
        }
      }

      // Wait 10 seconds before replacing order to let market stabilize
      // This helps avoid repeat fills during rapid price movements
      this.logger.warn(`⏳ Waiting 10 seconds for market to stabilize before replacing order...`);
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check if bot is still running and hasn't been stopped during the wait
      if (!this.state.isRunning || this.stopRequested) {
        this.logger.warn('Bot stopped during fill processing, skipping order replacement');
        return;
      }

      // Verify position is still zero before placing new orders
      const currentPosition = await this.orderManager.getCurrentPosition();
      if (currentPosition.abs().gte(new Decimal('0.00001'))) {
        this.logger.error(`⚠️⚠️⚠️ NON-ZERO POSITION after fill processing: ${currentPosition} BTC`);
        await this.closeDetectedPosition(currentPosition);
        return;
      }

      // Replace the filled order with fresh mark price from REST API
      // IMPORTANT: Use fresh mark price from REST API to avoid placing orders at stale prices
      this.logger.warn(`🔄 Replacing ${side.toUpperCase()} order with fresh mark price...`);
      await this.replaceOrder(side === 'buy' ? 'buy' : 'sell', true);

      this.emit('trade_executed', { side, qty, price: price.toString() });

    } catch (error: any) {
      this.logger.error(`Error handling order filled: ${error.message}`);
      console.error(error.stack);
    } finally {
      // Always clear the flag, even if an error occurred
      this.isProcessingFill = false;
    }
  }

  /**
   * Ensure zero position
   */
  private async ensureZeroPosition(): Promise<void> {
    try {
      const position = await this.client.getPosition(this.config.trading.symbol);

      if (position.abs().gt(0)) {
        this.logger.warn(`Existing position detected: ${position} BTC`);
        await telegram.warning(`Existing position: ${position} BTC, closing...`);

        const side = position.gt(0) ? 'sell' : 'buy';
        const closed = await this.orderManager.closePosition(position.abs(), side);

        if (closed) {
          this.logger.info('✅ Existing position closed');
        } else {
          this.logger.error('Failed to close existing position!');
          throw new Error('Failed to close existing position');
        }
      }

    } catch (error: any) {
      this.logger.error(`Error ensuring zero position: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get bot state
   */
  getState(): BotState {
    return { ...this.state };
  }

  /**
   * Get bot uptime
   */
  getUptime(): string {
    const uptime = Date.now() - this.startTime;
    const hours = Math.floor(uptime / 3600000);
    const minutes = Math.floor((uptime % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }

  /**
   * Check if bot is running
   */
  isRunning(): boolean {
    return this.state.isRunning;
  }
}
