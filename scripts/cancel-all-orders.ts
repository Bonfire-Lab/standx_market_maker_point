import { StandXAuth } from '../src/api/standx-auth';
import { StandXClient } from '../src/api/standx-client';
import { getConfig } from '../src/config';
import { log } from '../src/utils/logger';

/**
 * Cancel all open orders
 */
async function main() {
  const config = getConfig();

  log.info('🔄 Canceling all orders...');

  // Initialize auth
  const auth = new StandXAuth(
    config.standx.privateKey,
    config.standx.address,
    config.standx.chain
  );

  // Login to get access token
  await auth.login();

  // Initialize client
  const client = new StandXClient(auth);
  await client.initialize(config.trading.symbol);

  // Get open orders
  const orders = await client.getOpenOrders(config.trading.symbol);

  log.info(`Found ${orders.length} open orders:`);
  orders.forEach(order => {
    log.info(`  - ${order.side} order: ${order.orderId} @ $${order.price} (clientOrderId: ${order.clientOrderId})`);
  });

  // Cancel all orders
  for (const order of orders) {
    const success = await client.cancelOrder(order.orderId);
    if (success) {
      log.info(`✅ Canceled ${order.side} order ${order.orderId}`);
    } else {
      log.error(`❌ Failed to cancel ${order.side} order ${order.orderId}`);
    }
  }

  // Check remaining orders
  const remainingOrders = await client.getOpenOrders(config.trading.symbol);
  log.info(`\n📊 Remaining open orders: ${remainingOrders.length}`);

  if (remainingOrders.length === 0) {
    log.info('✅ All orders canceled successfully!');
  } else {
    log.warn('⚠️  Some orders could not be canceled');
  }
}

main().catch(console.error);
