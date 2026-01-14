import { MakerPointsBot } from './bot/maker-points-bot';
import { log } from './utils/logger';
import { getConfig, getAccounts } from './config';

/**
 * Multi-account bot manager
 * Manages multiple bot instances for different accounts
 */
class BotManager {
  private bots: Map<string, MakerPointsBot> = new Map();
  private config = getConfig();

  /**
   * Start all bots
   */
  async startAll(): Promise<void> {
    const accounts = getAccounts();

    if (accounts.length === 0) {
      log.error('No accounts configured. Please set up accounts in .env file');
      log.error('');
      log.error('Example configurations:');
      log.error('  Legacy format: STANDX_WALLET_PRIVATE_KEY=xxx, STANDX_WALLET_ADDRESS=xxx');
      log.error('  Multi-account: ACCOUNT_1_NAME=Account1, ACCOUNT_1_PRIVATE_KEY=xxx, ACCOUNT_1_ADDRESS=xxx');
      log.error('  JSON format: ACCOUNTS=[{"name":"A1","privateKey":"xxx","address":"xxx"}]');
      process.exit(1);
    }

    console.log('╔════════════════════════════════════════╗');
    console.log('║   StandX Maker Points Farming Bot      ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`Configuration:`);
    console.log(`  Symbol: ${this.config.trading.symbol}`);
    console.log(`  Mode: ${this.config.trading.mode}`);
    console.log(`  Order Size: ${this.config.trading.orderSizeBtc} BTC`);
    console.log(`  Target Distance: ${this.config.trading.orderDistanceBp} bp`);
    console.log(`  Valid Range: ${this.config.trading.minDistanceBp}-${this.config.trading.maxDistanceBp} bp`);
    console.log('');
    console.log(`Accounts: ${accounts.length}`);
    accounts.forEach(acc => {
      console.log(`  - ${acc.name}: ${acc.address.slice(0, 8)}...${acc.address.slice(-6)}`);
    });
    console.log('');

    // Validate each account has credentials
    for (const account of accounts) {
      if (!account.privateKey || !account.address) {
        log.error(`Account ${account.name} is missing credentials`);
        process.exit(1);
      }
    }

    // Create and start bots sequentially with a small delay between each
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      log.info(`[${account.name}] Starting bot ${i + 1}/${accounts.length}...`);

      const bot = new MakerPointsBot(account);
      this.bots.set(account.name, bot);

      // Setup event handlers
      this.setupBotEventHandlers(bot);

      try {
        await bot.start();

        // Small delay between starting bots to avoid overwhelming the API
        if (i < accounts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error: any) {
        log.error(`[${account.name}] Failed to start: ${error.message}`);
        // Continue starting other bots even if one fails
      }
    }

    console.log('');
    console.log('✅ All bots started successfully!');
    console.log('');

    // Start status updates
    this.startStatusUpdates();
  }

  /**
   * Setup event handlers for a bot
   */
  private setupBotEventHandlers(bot: MakerPointsBot): void {
    const accountId = bot.getAccountId();

    bot.on('started', () => {
      console.log(`[${accountId}] ✅ Bot started`);
    });

    bot.on('stopped', () => {
      console.log(`[${accountId}] ✅ Bot stopped`);
    });

    bot.on('order_replaced', (data: any) => {
      console.log(`[${accountId}] 🔄 ${data.side.toUpperCase()} order replaced`);
    });

    bot.on('trade_executed', (data: any) => {
      console.log(`[${accountId}] ⚠️  TRADE EXECUTED: ${data.side.toUpperCase()} ${data.qty} BTC @ $${data.price}`);
    });
  }

  /**
   * Start periodic status updates
   */
  private startStatusUpdates(): void {
    // Update status every 30 seconds
    setInterval(() => {
      console.log('');
      console.log('═'.repeat(60));
      console.log(`📊 Status Update - ${new Date().toLocaleTimeString()}`);
      console.log('═'.repeat(60));

      for (const [name, bot] of this.bots) {
        if (bot.isRunning()) {
          const state = bot.getState();
          const uptime = bot.getUptime();
          const buyOrderActive = state.buyOrder && state.buyOrder.status === 'OPEN';
          const sellOrderActive = state.sellOrder && state.sellOrder.status === 'OPEN';

          console.log(`${name}:`);
          console.log(`  Uptime: ${uptime}`);
          console.log(`  Mark Price: $${state.markPrice.toFixed(2)}`);
          console.log(`  Position: ${state.position.toFixed(4)} BTC`);
          console.log(`  Buy Order: ${buyOrderActive ? `Yes @ $${state.buyOrder!.price.toFixed(2)}` : 'No'}`);
          console.log(`  Sell Order: ${sellOrderActive ? `Yes @ $${state.sellOrder!.price.toFixed(2)}` : 'No'}`);
          console.log(`  Placed: ${state.stats.ordersPlaced} | Canceled: ${state.stats.ordersCanceled} | Filled: ${state.stats.ordersFilled}`);
          console.log('');
        } else {
          console.log(`${name}: NOT RUNNING`);
          console.log('');
        }
      }
      console.log('═'.repeat(60));
      console.log('');
    }, 30000);
  }

  /**
   * Stop all bots
   */
  async stopAll(): Promise<void> {
    console.log('');
    console.log('🛑 Stopping all bots...');

    const stopPromises = Array.from(this.bots.values()).map(async (bot) => {
      const accountId = bot.getAccountId();
      try {
        await bot.stop();
        console.log(`[${accountId}] ✅ Stopped`);
      } catch (error: any) {
        console.error(`[${accountId}] Error stopping: ${error.message}`);
      }
    });

    await Promise.all(stopPromises);
    console.log('✅ All bots stopped');
  }

  /**
   * Get all bots
   */
  getBots(): Map<string, MakerPointsBot> {
    return this.bots;
  }
}

/**
 * Main application entry point
 */
async function main() {
  const botManager = new BotManager();

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Received shutdown signal, stopping all bots...');
    await botManager.stopAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await botManager.startAll();

    // Keep process running
    console.log('Bot is running. Press Ctrl+C to stop.');
    console.log('');

  } catch (error: any) {
    const errorMsg = `Fatal error: ${error.message}`;
    console.error(errorMsg);
    console.error('Stack:', error.stack);

    // Keep process running for 10 seconds so user can see error
    setTimeout(() => {
      process.exit(1);
    }, 10000);
  }
}

// Run main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
