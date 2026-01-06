import blessed from 'blessed';
import { BotState } from '../types';
import Decimal from 'decimal.js';
import EventEmitter from 'eventemitter3';

/**
 * Terminal User Interface
 * Real-time monitoring dashboard
 */
export class TUI extends EventEmitter {
  private screen: any;
  private boxes: any = {};

  constructor() {
    super();

    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'StandX Maker Points Bot'
    });

    // Handle keys
    this.screen.key(['q', 'C-c'], () => {
      this.emit('quit');
    });

    this.screen.key('s', () => {
      this.emit('toggle_stop');
    });

    this.screen.key('c', () => {
      this.emit('cancel_orders');
    });

    this.createLayout();
  }

  /**
   * Create UI layout
   */
  private createLayout(): void {
    const height = this.screen.height;
    const width = this.screen.width;

    // Header box
    this.boxes.header = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: '{center}{bold}StandX Maker Points Bot{/bold}{/center}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue'
      }
    });

    // Status box
    this.boxes.status = blessed.box({
      top: 1,
      left: 0,
      width: '50%',
      height: 8,
      label: ' Status ',
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      },
      tags: true
    });

    // Orders box
    this.boxes.orders = blessed.box({
      top: 1,
      left: '50%',
      width: '50%',
      height: 8,
      label: ' Open Orders ',
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      },
      tags: true
    });

    // Stats box
    this.boxes.stats = blessed.box({
      top: 9,
      left: 0,
      width: '50%',
      height: 6,
      label: ' Statistics ',
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      },
      tags: true
    });

    // Recent trades box
    this.boxes.trades = blessed.box({
      top: 9,
      left: '50%',
      width: '50%',
      height: 6,
      label: ' Recent Trades ',
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      },
      tags: true
    });

    // Logs box
    this.boxes.logs = blessed.box({
      top: 15,
      left: 0,
      width: '100%',
      height: height - 16,
      label: ' Logs ',
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      },
      tags: true,
      keys: true,
      vi: true,
      mouse: true
    });

    // Help box
    this.boxes.help = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' [q] Quit  [s] Stop/Start  [c] Cancel All ',
      tags: true,
      style: {
        fg: 'black',
        bg: 'white'
      }
    });

    // Append all boxes to screen
    Object.values(this.boxes).forEach(box => {
      this.screen.append(box);
    });
  }

  /**
   * Update status display
   */
  updateStatus(state: BotState, uptime: string): void {
    const statusColor = state.isRunning ? 'green' : 'red';
    const statusText = state.isRunning ? 'RUNNING' : 'STOPPED';

    const modeText = state.buyOrder && state.sellOrder ? 'BOTH' :
                     state.buyOrder ? 'BUY ONLY' :
                     state.sellOrder ? 'SELL ONLY' : 'NONE';

    const content = [
      `{cyan}Status:{/cyan} {${statusColor}}${statusText}{/${statusColor}}      {cyan}Uptime:{/cyan} ${uptime}`,
      `{cyan}Mark Price:{/cyan} $${state.markPrice.toFixed(2)}`,
      `{cyan}Position:{/cyan} ${state.position.toFixed(4)} BTC`,
      ``,
      `{cyan}Trading Mode:{/cyan} ${modeText}`
    ].join('\n');

    this.boxes.status.setContent(content);
    this.screen.render();
  }

  /**
   * Update orders display
   */
  updateOrders(state: BotState): void {
    const lines: string[] = [];

    if (state.buyOrder) {
      const status = state.buyOrder.status === 'OPEN' ? '{green}OPEN{/green}' :
                     state.buyOrder.status === 'FILLED' ? '{yellow}FILLED{/yellow}' :
                     '{red}CANCELED{/red}';
      lines.push(`{cyan}BUY:{/cyan}  ${state.buyOrder.qty.toFixed(4)} BTC @ $${state.buyOrder.price.toFixed(2)} ${status}`);
    } else {
      lines.push(`{gray}No buy order{/gray}`);
    }

    if (state.sellOrder) {
      const status = state.sellOrder.status === 'OPEN' ? '{green}OPEN{/green}' :
                     state.sellOrder.status === 'FILLED' ? '{yellow}FILLED{/yellow}' :
                     '{red}CANCELED{/red}';
      lines.push(`{cyan}SELL:{/cyan} ${state.sellOrder.qty.toFixed(4)} BTC @ $${state.sellOrder.price.toFixed(2)} ${status}`);
    } else {
      lines.push(`{gray}No sell order{/gray}`);
    }

    this.boxes.orders.setContent(lines.join('\n'));
    this.screen.render();
  }

  /**
   * Update statistics display
   */
  updateStats(state: BotState): void {
    const points = this.estimatePoints(state.stats);
    const fillRate = this.calculateFillRate(state.stats);

    const content = [
      `{cyan}Orders Placed:{/cyan} {bold}${state.stats.ordersPlaced}{/bold}`,
      `{cyan}Orders Canceled:{/cyan} {bold}${state.stats.ordersCanceled}{/bold}`,
      `{cyan}Orders Filled:{/cyan} {bold}${state.stats.ordersFilled}{/bold}`,
      ``,
      `{cyan}Est. Points:{/cyan} ~${points}`,
      `{cyan}Fill Rate:{/cyan} ${fillRate.toFixed(1)}%`
    ].join('\n');

    this.boxes.stats.setContent(content);
    this.screen.render();
  }

  /**
   * Update recent trades
   */
  updateTrades(lastTrade?: { time: string; side: string; qty: string; price: string }): void {
    if (lastTrade) {
      const time = new Date(lastTrade.time).toLocaleTimeString();
      const color = lastTrade.side === 'buy' ? 'green' : 'red';
      const content = `[${time}] {${color}}${lastTrade.side.toUpperCase()}/{/${color}} ${lastTrade.qty} BTC @ $${lastTrade.price}`;
      this.boxes.trades.setContent(content);
    } else {
      this.boxes.trades.setContent('{gray}No trades yet{/gray}');
    }
    this.screen.render();
  }

  /**
   * Add log entry
   */
  addLog(level: string, message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const color = level === 'ERROR' ? 'red' :
                  level === 'WARN' ? 'yellow' :
                  level === 'DEBUG' ? 'gray' : 'white';

    const logLine = `{${color}}[${timestamp}] [${level}] ${message}{/${color}}`;

    this.boxes.logs.insertBottom(logLine + '\n');
    this.boxes.logs.setScrollPerc(100);
    this.screen.render();
  }

  /**
   * Estimate maker points earned
   */
  private estimatePoints(stats: any): string {
    // Rough estimation: 1 point per order per 3 seconds
    // This is just for display purposes
    const avgOrderTime = 3; // seconds
    const pointsPerOrder = 1;
    const totalPoints = (stats.ordersPlaced * pointsPerOrder).toString();
    return totalPoints;
  }

  /**
   * Calculate fill rate
   */
  private calculateFillRate(stats: any): number {
    if (stats.ordersPlaced === 0) return 0;
    return (stats.ordersFilled / stats.ordersPlaced) * 100;
  }

  /**
   * Update entire UI
   */
  update(state: BotState, uptime: string): void {
    this.updateStatus(state, uptime);
    this.updateOrders(state);
    this.updateStats(state);
    this.screen.render();
  }

  /**
   * Show error message
   */
  showError(message: string): void {
    const modal = blessed.box({
      top: 'center',
      left: 'center',
      width: '50%',
      height: 5,
      content: `{red}{bold}ERROR{/bold}{/red}\n\n${message}`,
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'red',
        border: { fg: 'red' }
      }
    });

    this.screen.append(modal);
    this.screen.render();

    setTimeout(() => {
      this.screen.remove(modal);
      this.screen.render();
    }, 3000);
  }

  /**
   * Destroy UI
   */
  destroy(): void {
    this.screen.destroy();
  }
}
