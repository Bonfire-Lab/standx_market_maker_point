import { MakerPointsBot } from './bot/maker-points-bot';
import { log } from './utils/logger';
import { getConfig } from './config';

/**
 * Main application entry point
 */
async function main() {
  const config = getConfig();

  // Validate configuration
  if (!config.standx.privateKey || !config.standx.address) {
    log.error('Missing StandX wallet credentials. Please check your .env file.');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════╗');
  console.log('║   StandX Maker Points Farming Bot      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`Configuration:`);
  console.log(`  Symbol: ${config.trading.symbol}`);
  console.log(`  Mode: ${config.trading.mode}`);
  console.log(`  Order Size: ${config.trading.orderSizeBtc} BTC`);
  console.log(`  Target Distance: ${config.trading.orderDistanceBp} bp`);
  console.log(`  Valid Range: ${config.trading.minDistanceBp}-${config.trading.maxDistanceBp} bp`);
  console.log('');

  // Create bot
  const bot = new MakerPointsBot();

  // Setup bot event handlers for logging
  bot.on('started', () => {
    console.log('✅ Bot started successfully!');
    console.log('');
  });

  bot.on('stopped', () => {
    console.log('✅ Bot stopped');
  });

  bot.on('mark_price_updated', (markPrice) => {
    console.log(`📊 Mark Price Updated: $${markPrice.toFixed(2)}`);
  });

  bot.on('order_updated', () => {
    const state = bot.getState();
    console.log(`📝 Orders Updated - Buy: ${state.buyOrder ? 'Yes' : 'No'}, Sell: ${state.sellOrder ? 'Yes' : 'No'}`);
  });

  bot.on('order_replaced', (data: any) => {
    console.log(`🔄 ${data.side.toUpperCase()} order replaced`);
  });

  bot.on('trade_executed', (data: any) => {
    console.log(`⚠️  TRADE EXECUTED: ${data.side.toUpperCase()} ${data.qty} BTC @ $${data.price}`);
  });

  bot.on('position_updated', (position) => {
    if (position.abs().gt(0)) {
      console.log(`💼 Position: ${position.toFixed(4)} BTC`);
    }
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, stopping bot...');
    await bot.stop();
    process.exit(0);
  });

  try {
    // Start bot
    await bot.start();

    // Update status every 10 seconds
    setInterval(() => {
      const state = bot.getState();
      const uptime = bot.getUptime();
      console.log('');
      console.log('═'.repeat(50));
      console.log(`📊 Status Update (${uptime})`);
      console.log(`  Mark Price: $${state.markPrice.toFixed(2)}`);
      console.log(`  Position: ${state.position.toFixed(4)} BTC`);
      console.log(`  Buy Order: ${state.buyOrder ? `Yes @ $${state.buyOrder.price.toFixed(2)}` : 'No'}`);
      console.log(`  Sell Order: ${state.sellOrder ? `Yes @ $${state.sellOrder.price.toFixed(2)}` : 'No'}`);
      console.log(`  Placed: ${state.stats.ordersPlaced} | Canceled: ${state.stats.ordersCanceled} | Filled: ${state.stats.ordersFilled}`);
      console.log('═'.repeat(50));
      console.log('');
    }, 10000);

    // Hourly status to Telegram
    if (config.telegram.enabled) {
      setInterval(async () => {
        if (bot.isRunning()) {
          const state = bot.getState();
          await telegram.status(
            true,
            bot.getUptime(),
            state.stats
          );
        }
      }, 3600000); // 1 hour
    }

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

// Import telegram after to avoid circular dependency
import { telegram } from './notify/telegram';

// Run main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
