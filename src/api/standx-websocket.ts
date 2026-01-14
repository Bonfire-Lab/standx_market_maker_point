import EventEmitter from 'eventemitter3';
import { StandXAuth } from './standx-auth';
import { WSMarkPriceData, WSOrderData, WSPositionData } from '../types';
import { wsLog } from '../utils/ws-logger';

/**
 * Bun WebSocket wrapper that provides ws-like interface
 */
class BunWebSocket {
  ws: WebSocket;
  readyState: number;

  constructor(url: string, options?: { handshakeTimeout?: number }) {
    this.ws = new WebSocket(url);
    this.readyState = this.ws.readyState;

    // Forward readyState changes
    this.ws.addEventListener('open', () => {
      this.readyState = 1; // OPEN
    });

    this.ws.addEventListener('close', () => {
      this.readyState = 3; // CLOSED
    });
  }

  on(event: 'open' | 'message' | 'error' | 'close' | 'ping', callback: (...args: any[]) => void): void {
    switch (event) {
      case 'open':
        this.ws.addEventListener('open', callback);
        break;
      case 'message':
        this.ws.addEventListener('message', (event: MessageEvent) => {
          callback(event.data);
        });
        break;
      case 'error':
        this.ws.addEventListener('error', callback);
        break;
      case 'close':
        this.ws.addEventListener('close', callback);
        break;
      case 'ping':
        // Bun's WebSocket doesn't emit ping events like ws does
        // This is a no-op for compatibility
        break;
    }
  }

  send(data: string | Buffer): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }

  pong(): void {
    // Bun's WebSocket handles ping/pong automatically
    // This is a no-op for compatibility
  }

  static get OPEN(): number { return 1; }
}

/**
 * StandX WebSocket Client
 * Handles Market Stream and Order Stream connections
 */
export class StandXWebSocket extends EventEmitter {
  private auth: StandXAuth;
  private marketWS: InstanceType<typeof BunWebSocket> | null = null;
  private orderWS: InstanceType<typeof BunWebSocket> | null = null;
  private marketUrl: string;
  private orderUrl: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 30;
  private reconnectDelay: number = 1000;
  private isManualClose: boolean = false;

  constructor(auth: StandXAuth) {
    super();
    this.auth = auth;
    this.marketUrl = 'wss://perps.standx.com/ws-stream/v1';
    this.orderUrl = 'wss://perps.standx.com/ws-api/v1';
  }

  /**
   * Connect to both WebSocket streams
   * Note: auth.loginWithPrivateKey() must be called before this method
   */
  async connect(): Promise<void> {
    this.isManualClose = false;

    // Connect Market Stream
    await this.connectMarketStream();

    // Connect Order Response Stream
    await this.connectOrderStream();
  }

  /**
   * Connect to Market Stream
   */
  private connectMarketStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.marketWS = new BunWebSocket(this.marketUrl);

        this.marketWS.on('open', () => {
          wsLog.info('Market Stream connected');
          this.reconnectAttempts = 0;
          resolve();
        });

        this.marketWS.on('message', (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            // Only log in debug mode - this fires ~3 times per second
            wsLog.debug('Market message:', message.channel);
            this.handleMarketMessage(message);
          } catch (error) {
            wsLog.error('Failed to parse market message');
          }
        });

        this.marketWS.on('error', (error) => {
          wsLog.error('Market Stream error:', error);
        });

        this.marketWS.on('close', () => {
          wsLog.warn('Market Stream closed');
          if (!this.isManualClose) {
            this.scheduleReconnect('market');
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect to Order Response Stream
   */
  private connectOrderStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.orderWS = new BunWebSocket(this.orderUrl);

        this.orderWS.on('open', () => {
          wsLog.info('Order Stream connected');
          resolve();
        });

        this.orderWS.on('message', (data: any) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleOrderMessage(message);
          } catch (error) {
            wsLog.error('Failed to parse order message');
          }
        });

        this.orderWS.on('error', (error) => {
          wsLog.error('Order Stream error:', error);
        });

        this.orderWS.on('close', () => {
          wsLog.warn('Order Stream closed');
          if (!this.isManualClose) {
            this.scheduleReconnect('order');
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle Market Stream messages
   */
  private handleMarketMessage(message: any): void {
    const channel = message.channel;

    // Handle price channel for mark price
    if (channel === 'price' || channel === 'ticker' || channel === 'symbol_price') {
      this.handleMarkPrice(message.data || message);
      return;
    }

    switch (channel) {
      case 'order':
        wsLog.debug('Order message received');
        this.handleUserOrders(message.data);
        break;
      case 'position':
        this.handleUserPosition(message.data);
        break;
      default:
        // Silently ignore unknown channels - don't log
        break;
    }
  }

  /**
   * Handle Order Response Stream messages
   */
  private handleOrderMessage(message: any): void {
    // Handle order creation responses
    if (message.result) {
      this.emit('order_response', message.result);
    }
  }

  /**
   * Handle mark price updates
   */
  private handleMarkPrice(data: any): void {
    const markPriceData: WSMarkPriceData = {
      symbol: data.symbol,
      markPrice: data.mark_price || data.markPrice,
      indexPrice: data.index_price || data.indexPrice,
      lastPrice: data.last_price || data.lastPrice,
      midPrice: data.mid_price || data.midPrice,
      spread: data.spread || undefined,
      timestamp: data.timestamp || data.time || Date.now()
    };

    this.emit('mark_price', markPriceData);
  }

  /**
   * Handle user order updates
   */
  private handleUserOrders(data: any): void {
    const orderData: WSOrderData = {
      orderId: data.id || data.order_id,
      clientOrderId: data.cl_ord_id || data.clientOrderId,
      symbol: data.symbol,
      status: (data.status || 'OPEN').toUpperCase(),
      side: data.side,
      qty: data.qty,
      price: data.price,
      fillQty: data.fill_qty || data.fillQty,
      avgFillPrice: data.avg_fill_price || data.avgFillPrice
    };

    // Only log important state changes, not every update
    if (orderData.status === 'FILLED' || orderData.status === 'CANCELED') {
      wsLog.info(`Order ${orderData.clientOrderId}: ${orderData.status}`);
    }

    this.emit('order_update', orderData);
  }

  /**
   * Handle user position updates
   */
  private handleUserPosition(data: any): void {
    const positionData: WSPositionData = {
      symbol: data.symbol,
      positionAmt: data.position_amt || data.qty,
      entryPrice: data.entry_price,
      unrealizedPnl: data.unrealized_pnl
    };

    this.emit('position_update', positionData);
  }

  /**
   * Subscribe to mark price channel
   */
  subscribeMarkPrice(symbols: string[]): void {
    const symbol = symbols[0];

    this.marketWS?.send(JSON.stringify({
      subscribe: {
        channel: 'price',
        symbol: symbol
      }
    }));

    wsLog.info(`Subscribed to price channel for ${symbol}`);
  }

  /**
   * Subscribe to user orders channel
   */
  subscribeUserOrders(): void {
    // NOTE: This is handled by subscribeUserStreams()
    wsLog.debug('subscribeUserOrders called - using subscribeUserStreams');
  }

  /**
   * Subscribe to user position channel
   */
  subscribeUserPosition(): void {
    // NOTE: This is handled by subscribeUserStreams()
    wsLog.debug('subscribeUserPosition called - using subscribeUserStreams');
  }

  /**
   * Subscribe to both order and position channels
   */
  subscribeUserStreams(): void {
    this.marketWS?.send(JSON.stringify({
      auth: {
        token: this.auth.getAccessToken(),
        streams: [
          { channel: 'order' },
          { channel: 'position' }
        ]
      }
    }));
    wsLog.info('Subscribed to order and position streams');
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(stream: 'market' | 'order'): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      wsLog.error(`Max reconnect attempts reached for ${stream} stream`);
      this.emit('max_reconnect_reached');
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    wsLog.warn(`Reconnecting ${stream} in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.emit('reconnecting', { stream, attempt: this.reconnectAttempts, delay });

    setTimeout(async () => {
      if (this.isManualClose) return;

      try {
        if (stream === 'market') {
          await this.connectMarketStream();
          this.emit('market_reconnected');
        } else {
          await this.connectOrderStream();
          this.emit('order_reconnected');
        }
      } catch (error) {
        wsLog.error(`Failed to reconnect ${stream} stream`);
        this.scheduleReconnect(stream);
      }
    }, delay);
  }

  /**
   * Disconnect from both streams
   */
  disconnect(): void {
    this.isManualClose = true;

    if (this.marketWS) {
      this.marketWS.close();
      this.marketWS = null;
    }

    if (this.orderWS) {
      this.orderWS.close();
      this.orderWS = null;
    }

    wsLog.info('Disconnected from all streams');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.marketWS?.readyState === BunWebSocket.OPEN ||
           this.orderWS?.readyState === BunWebSocket.OPEN;
  }
}
