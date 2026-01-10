#!/usr/bin/env tsx
/**
 * Test script to fetch symbol price via REST API
 * Run: tsx scripts/test-rest-price.ts
 */

import axios from 'axios';

const REST_API = 'https://perps.standx.com/api/query_symbol_price';
const SYMBOL = 'BTC-USD';

async function fetchPrice() {
  try {
    const response = await axios.get(REST_API, {
      params: { symbol: SYMBOL },
      timeout: 10000
    });

    console.log('REST API Response:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data) {
      const data = response.data;
      console.log('\n📊 KEY FIELDS:');
      if (data.mark_price) console.log(`  mark_price:   ${data.mark_price}`);
      if (data.index_price) console.log(`  index_price: ${data.index_price}`);
      if (data.last_price) console.log(`  last_price:   ${data.last_price}`);
      if (data.mid_price) console.log(`  mid_price:    ${data.mid_price}`);

      // REST API uses spread_bid and spread_ask (not spread array)
      const bid = data.spread_bid;
      const ask = data.spread_ask;
      if (bid && ask) {
        console.log(`  spread_bid:   ${bid}`);
        console.log(`  spread_ask:   ${ask}`);
        const spreadBp = ((parseFloat(ask) - parseFloat(bid)) / parseFloat(ask)) * 10000;
        console.log(`    → spread: ${spreadBp.toFixed(2)} bp`);
      }

      // Calculate distances from mark price
      if (data.mark_price && bid && ask) {
        const mark = parseFloat(data.mark_price);
        const bidNum = parseFloat(bid);
        const askNum = parseFloat(ask);

        console.log('\n📏 DISTANCES FROM MARK PRICE:');
        const bidDistBp = ((mark - bidNum) / mark) * 10000;
        const askDistBp = ((askNum - mark) / mark) * 10000;
        console.log(`  mark - bid: ${bidDistBp.toFixed(2)} bp`);
        console.log(`  ask - mark: ${askDistBp.toFixed(2)} bp`);

        // Check if mark is within spread
        if (mark >= bidNum && mark <= askNum) {
          console.log(`  ✅ Mark price is WITHIN spread`);
        } else {
          console.log(`  ⚠️  Mark price is OUTSIDE spread`);
          if (mark < bidNum) {
            const belowBp = ((bidNum - mark) / mark) * 10000;
            console.log(`     Mark is ${belowBp.toFixed(2)} bp BELOW bid`);
          }
          if (mark > askNum) {
            const aboveBp = ((mark - askNum) / mark) * 10000;
            console.log(`     Mark is ${aboveBp.toFixed(2)} bp ABOVE ask`);
          }
        }
      }
    }

  } catch (error: any) {
    console.error('Error fetching price:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function main() {
  // Fetch multiple times to see changes
  console.log(`Fetching price for ${SYMBOL} from REST API...\n`);

  await fetchPrice();

  console.log('\n\nFetching again after 2 seconds...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await fetchPrice();

  console.log('\n\nFetching again after 2 seconds...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await fetchPrice();
}

main().catch(console.error);
