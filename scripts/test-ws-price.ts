#!/usr/bin/env tsx
/**
 * Test script to capture WebSocket price channel messages
 * Run: tsx scripts/test-ws-price.ts
 */

import WebSocket from 'ws';

const MARKET_STREAM_URL = 'wss://perps.standx.com/ws-stream/v1';
const SYMBOL = 'BTC-USD';

console.log('Connecting to StandX Market Stream...');
console.log(`Symbol: ${SYMBOL}`);
console.log('');

const ws = new WebSocket(MARKET_STREAM_URL);

ws.on('open', () => {
  console.log('✅ Connected!\n');

  // Subscribe to price channel
  const subscribeMsg = {
    subscribe: {
      channel: 'price',
      symbol: SYMBOL
    }
  };

  console.log('Sending subscribe request:', JSON.stringify(subscribeMsg, null, 2));
  ws.send(JSON.stringify(subscribeMsg));
});

ws.on('message', (data: Buffer) => {
  try {
    const message = JSON.parse(data.toString());
    const channel = message.channel;

    if (channel === 'price' || channel === 'ticker' || channel === 'symbol_price') {
      console.log('\n' + '='.repeat(80));
      console.log('PRICE CHANNEL MESSAGE:');
      console.log('='.repeat(80));

      // Pretty print the entire message
      console.log(JSON.stringify(message, null, 2));

      // Extract and highlight key fields
      if (message.data) {
        const data = message.data;
        console.log('\n📊 KEY FIELDS:');
        if (data.mark_price) console.log(`  mark_price:   ${data.mark_price}`);
        if (data.index_price) console.log(`  index_price: ${data.index_price}`);
        if (data.last_price) console.log(`  last_price:   ${data.last_price}`);
        if (data.mid_price) console.log(`  mid_price:    ${data.mid_price}`);
        if (data.spread) {
          console.log(`  spread:       ${JSON.stringify(data.spread)}`);
          if (Array.isArray(data.spread) && data.spread.length >= 2) {
            const [bid, ask] = data.spread;
            console.log(`    → bid: ${bid}`);
            console.log(`    → ask: ${ask}`);
            if (bid && ask) {
              const spreadBp = ((parseFloat(ask) - parseFloat(bid)) / parseFloat(ask)) * 10000;
              console.log(`    → spread: ${spreadBp.toFixed(2)} bp`);
            }
          }
        }
      }
    } else {
      console.log(`\n[Other channel: ${channel}]`);
      console.log(JSON.stringify(message).substring(0, 200));
    }
  } catch (error) {
    console.error('Failed to parse message:', error);
    console.log('Raw:', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('\n\n❌ Connection closed');
  process.exit(0);
});

// Run for 30 seconds then exit
setTimeout(() => {
  console.log('\n\n⏱️ Timeout reached, closing...');
  ws.close();
}, 30000);

console.log('Waiting for messages... (will exit after 30 seconds)');
