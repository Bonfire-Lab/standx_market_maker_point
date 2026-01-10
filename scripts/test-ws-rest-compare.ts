#!/usr/bin/env tsx
/**
 * Compare WebSocket vs REST API price data
 * Run: tsx scripts/test-ws-rest-compare.ts
 */

import axios from 'axios';
import WebSocket from 'ws';

const REST_API = 'https://perps.standx.com/api/query_symbol_price';
const MARKET_STREAM_URL = 'wss://perps.standx.com/ws-stream/v1';
const SYMBOL = 'BTC-USD';

interface PriceData {
  source: 'WS' | 'REST';
  mark_price: string;
  index_price: string;
  last_price: string;
  mid_price: string;
  spread_bid?: string;
  spread_ask?: string;
  spread_arr?: [string, string];
  timestamp: string;
}

function formatBp(value1: number, value2: number): string {
  const bp = ((value2 - value1) / value1) * 10000;
  return `${bp > 0 ? '+' : ''}${bp.toFixed(2)} bp`;
}

function comparePrices(ws: PriceData, rest: PriceData) {
  console.log('\n' + '='.repeat(100));
  console.log('COMPARISON: WebSocket vs REST API');
  console.log('='.repeat(100));

  const wsMark = parseFloat(ws.mark_price);
  const restMark = parseFloat(rest.mark_price);

  console.log('\n📊 MARK PRICE:');
  console.log(`  WS:   ${ws.mark_price}`);
  console.log(`  REST: ${rest.mark_price}`);
  console.log(`  Diff: ${formatBp(wsMark, restMark)}`);

  console.log('\n📊 SPREAD:');
  if (ws.spread_arr && rest.spread_bid) {
    const [wsBid, wsAsk] = ws.spread_arr;
    console.log(`  WS:   bid=${wsBid}, ask=${wsAsk}`);
    console.log(`  REST: bid=${rest.spread_bid}, ask=${rest.spread_ask}`);

    const wsBidNum = parseFloat(wsBid);
    const wsAskNum = parseFloat(wsAsk);
    const restBidNum = parseFloat(rest.spread_bid);
    const restAskNum = parseFloat(rest.spread_ask);

    console.log(`  Bid diff:  ${formatBp(restBidNum, wsBidNum)}`);
    console.log(`  Ask diff:  ${formatBp(restAskNum, wsAskNum)}`);
  }

  console.log('\n📊 OTHER FIELDS:');
  console.log(`  index_price:  WS=${ws.index_price}, REST=${rest.index_price}`);
  console.log(`  last_price:   WS=${ws.last_price}, REST=${rest.last_price}`);
  console.log(`  mid_price:    WS=${ws.mid_price}, REST=${rest.mid_price}`);

  console.log('\n📏 KEY METRICS (from REST):');
  if (rest.spread_bid && rest.spread_ask) {
    const bid = parseFloat(rest.spread_bid);
    const ask = parseFloat(rest.spread_ask);
    const mark = restMark;

    const markToBid = ((mark - bid) / mark) * 10000;
    const askToMark = ((ask - mark) / mark) * 10000;
    const spreadBp = ((ask - bid) / ask) * 10000;

    console.log(`  mark - bid: ${markToBid.toFixed(2)} bp`);
    console.log(`  ask - mark: ${askToMark.toFixed(2)} bp`);
    console.log(`  spread:     ${spreadBp.toFixed(2)} bp`);

    // Check if last_price is far from mark
    const last = parseFloat(rest.last_price);
    const lastToMark = ((last - mark) / mark) * 10000;
    console.log(`  last - mark: ${lastToMark > 0 ? '+' : ''}${lastToMark.toFixed(2)} bp`);

    if (Math.abs(lastToMark) > 5) {
      console.log(`  ⚠️  WARNING: last_price is ${Math.abs(lastToMark).toFixed(2)} bp away from mark!`);
      console.log(`     This indicates high volatility or recent large trades.`);
    }
  }

  console.log('='.repeat(100));
}

async function main() {
  let wsPrice: PriceData | null = null;
  let restPrice: PriceData | null = null;

  // Fetch REST API
  async function fetchRest() {
    try {
      const response = await axios.get(REST_API, {
        params: { symbol: SYMBOL },
        timeout: 10000
      });
      restPrice = {
        source: 'REST',
        mark_price: response.data.mark_price,
        index_price: response.data.index_price,
        last_price: response.data.last_price,
        mid_price: response.data.mid_price,
        spread_bid: response.data.spread_bid,
        spread_ask: response.data.spread_ask,
        timestamp: response.data.time || new Date().toISOString()
      };
      console.log('✅ REST API data received');

      if (wsPrice) {
        comparePrices(wsPrice, restPrice);
      }
    } catch (error: any) {
      console.error('❌ REST API error:', error.message);
    }
  }

  // Connect WebSocket
  const ws = new WebSocket(MARKET_STREAM_URL);

  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    ws.send(JSON.stringify({
      subscribe: { channel: 'price', symbol: SYMBOL }
    }));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.channel === 'price' && !wsPrice) {
        const d = message.data;
        wsPrice = {
          source: 'WS',
          mark_price: d.mark_price,
          index_price: d.index_price,
          last_price: d.last_price,
          mid_price: d.mid_price,
          spread_arr: d.spread,
          timestamp: d.time || new Date().toISOString()
        };
        console.log('✅ WebSocket price data received');

        if (restPrice) {
          comparePrices(wsPrice, restPrice);
        }

        // After first comparison, fetch REST again for multiple comparisons
        setTimeout(fetchRest, 2000);
      }
    } catch (error) {
      // ignore parse errors
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });

  // Initial REST fetch
  await fetchRest();

  // Fetch REST every 3 seconds for comparison
  const interval = setInterval(fetchRest, 3000);

  // Run for 30 seconds
  setTimeout(() => {
    clearInterval(interval);
    ws.close();
    console.log('\n\n⏱️ Done!');
  }, 30000);
}

main().catch(console.error);
