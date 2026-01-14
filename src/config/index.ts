import convict from 'convict';
import dotenv from 'dotenv';
import { Config, TradingMode, AccountConfig } from '../types';
import path from 'path';

// Determine which .env file to load
// Can be specified via ENV_FILE environment variable
const envFile = process.env.ENV_FILE || path.join(process.cwd(), '.env');

// Load .env file
dotenv.config({ path: envFile });

console.log(`[Config] Loading env from: ${envFile}`);

/**
 * Parse accounts from environment variable
 * Format: ACCOUNTS=[{"name":"Account1","privateKey":"...","address":"..."},{"name":"Account2",...}]
 * Or use individual variables: ACCOUNT_1_NAME, ACCOUNT_1_PRIVATE_KEY, ACCOUNT_1_ADDRESS, etc.
 */
function parseAccounts(): AccountConfig[] {
  // Try JSON format first
  const accountsJson = process.env.ACCOUNTS;
  if (accountsJson) {
    try {
      const accounts = JSON.parse(accountsJson);
      if (Array.isArray(accounts) && accounts.length > 0) {
        console.log(`[Config] Loaded ${accounts.length} accounts from ACCOUNTS JSON`);
        return accounts.map((acc: any) => ({
          name: acc.name || acc.id || `Account-${acc.address?.slice(0, 8)}`,
          privateKey: acc.privateKey,
          address: acc.address,
          chain: acc.chain || 'bsc'
        }));
      }
    } catch (e) {
      console.warn('[Config] Failed to parse ACCOUNTS JSON, trying individual variables...');
    }
  }

  // Try individual account variables (fallback and legacy single account)
  const accounts: AccountConfig[] = [];

  // Check for legacy single account format
  const legacyKey = process.env.STANDX_WALLET_PRIVATE_KEY;
  const legacyAddress = process.env.STANDX_WALLET_ADDRESS;
  const legacyChain = process.env.STANDX_CHAIN || 'bsc';

  if (legacyKey && legacyAddress) {
    accounts.push({
      name: process.env.ACCOUNT_NAME || 'Account-1',
      privateKey: legacyKey,
      address: legacyAddress,
      chain: legacyChain as 'bsc' | 'solana'
    });
    console.log(`[Config] Loaded account from legacy format (STANDX_WALLET_*)`);
  }

  // Check for numbered accounts (ACCOUNT_1_*, ACCOUNT_2_*, etc.)
  let i = 1;
  while (true) {
    const name = process.env[`ACCOUNT_${i}_NAME`] || `Account-${i}`;
    const privateKey = process.env[`ACCOUNT_${i}_PRIVATE_KEY`];
    const address = process.env[`ACCOUNT_${i}_ADDRESS`];
    const chain = process.env[`ACCOUNT_${i}_CHAIN`] || 'bsc';

    if (!privateKey || !address) {
      break;
    }

    accounts.push({
      name,
      privateKey,
      address,
      chain: chain as 'bsc' | 'solana'
    });

    i++;
  }

  // If we found numbered accounts and they're different from legacy, use them
  if (i > 1 && (accounts.length > 1 || !legacyKey)) {
    console.log(`[Config] Loaded ${accounts.length} accounts from numbered variables (ACCOUNT_N_*)`);
  }

  if (accounts.length === 0) {
    console.warn('[Config] No accounts configured!');
  }

  return accounts;
}

// Define configuration schema
const config = convict({
  accounts: {
    doc: 'Trading accounts',
    format: Array,
    default: [],
  },
  trading: {
    symbol: {
      doc: 'Trading symbol',
      format: String,
      default: 'BTC-USD',
      env: 'TRADING_SYMBOL'
    },
    mode: {
      doc: 'Trading mode (both, buy, sell)',
      format: ['both', 'buy', 'sell'],
      default: 'both',
      env: 'TRADING_MODE'
    },
    orderSizeBtc: {
      doc: 'Order size in BTC',
      format: Number,
      default: 0.1,
      env: 'TRADING_ORDER_SIZE_BTC'
    },
    orderDistanceBp: {
      doc: 'Target order distance from mark price in basis points',
      format: Number,
      default: 20,
      env: 'TRADING_ORDER_DISTANCE_BP'
    },
    minDistanceBp: {
      doc: 'Minimum distance in basis points (too close = risk of fill)',
      format: Number,
      default: 10,
      env: 'TRADING_MIN_DISTANCE_BP'
    },
    maxDistanceBp: {
      doc: 'Maximum distance in basis points (too far = no points)',
      format: Number,
      default: 30,
      env: 'TRADING_MAX_DISTANCE_BP'
    }
  },
  telegram: {
    token: {
      doc: 'Telegram bot token',
      format: String,
      default: '',
      env: 'TELEGRAM_TOKEN'
    },
    chatId: {
      doc: 'Telegram chat ID',
      format: String,
      default: '',
      env: 'TELEGRAM_CHAT_ID'
    },
    enabled: {
      doc: 'Enable Telegram notifications',
      format: Boolean,
      default: true,
      env: 'TELEGRAM_ENABLED'
    }
  },
  logging: {
    level: {
      doc: 'Log level',
      format: ['debug', 'info', 'warn', 'error'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    toFile: {
      doc: 'Log to file',
      format: Boolean,
      default: true,
      env: 'LOG_TO_FILE'
    },
    toConsole: {
      doc: 'Log to console',
      format: Boolean,
      default: true,
      env: 'LOG_TO_CONSOLE'
    }
  }
});

// Parse accounts from environment
const parsedAccounts = parseAccounts();
config.set('accounts', parsedAccounts);

// Validate and load configuration
config.validate({ allowed: 'strict' });

// Export typed getters
export function getConfig(): Config {
  return config.get() as Config;
}

export function getAccounts(): AccountConfig[] {
  return parsedAccounts;
}

export default config;
