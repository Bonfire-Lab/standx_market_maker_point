#!/usr/bin/env tsx
/**
 * StandX Auth Test - Using exact code from docs
 * https://docs.standx.com/standx-api/perps-auth#complete-authentication-class-example
 */

import fs from 'fs';
import path from 'path';
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { ethers } from 'ethers';
import axios from 'axios';

function parseEnvFile(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      env[key] = value.trim();
    }
  }
  return env;
}

export type Chain = 'bsc' | 'solana';

export interface SignedData {
  domain: string;
  uri: string;
  statement: string;
  version: string;
  chainId: number;
  nonce: string;
  address: string;
  requestId: string;
  issuedAt: string;
  message: string;
  exp: number;
  iat: number;
}

export interface LoginResponse {
  token: string;
  address: string;
  alias: string;
  chain: string;
  perpsAlpha: boolean;
}

export class StandXAuthDocs {
  private ed25519PrivateKey: Uint8Array;
  private ed25519PublicKey: Uint8Array;
  private requestId: string;
  private baseUrl = 'https://api.standx.com';

  constructor() {
    // Use exact method from docs
    const privateKey = ed25519.utils.randomSecretKey();
    this.ed25519PrivateKey = privateKey;
    this.ed25519PublicKey = ed25519.getPublicKey(privateKey);
    this.requestId = base58.encode(this.ed25519PublicKey);
  }

  async authenticate(
    chain: Chain,
    walletAddress: string,
    signMessage: (msg: string) => Promise<string>
  ): Promise<LoginResponse> {
    const signedDataJwt = await this.prepareSignIn(chain, walletAddress);
    const payload = this.parseJwt<SignedData>(signedDataJwt);
    const signature = await signMessage(payload.message);
    return this.login(chain, signature, signedDataJwt);
  }

  private async prepareSignIn(chain: Chain, address: string): Promise<string> {
    const res = await axios.post(
      `${this.baseUrl}/v1/offchain/prepare-signin?chain=${chain}`,
      { address, requestId: this.requestId },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const data = res.data;
    if (!data.success) throw new Error('Failed to prepare sign-in');
    return data.signedData;
  }

  private async login(
    chain: Chain,
    signature: string,
    signedData: string,
    expiresSeconds: number = 604800
  ): Promise<LoginResponse> {
    const res = await axios.post(
      `${this.baseUrl}/v1/offchain/login?chain=${chain}`,
      {
        signature,
        signedData,
        expiresSeconds
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return res.data;
  }

  private parseJwt<T>(token: string): T {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
  }
}

// Test function
async function testAuth(envFile: string) {
  const env = parseEnvFile(path.join(process.cwd(), envFile));
  const address = env.STANDX_WALLET_ADDRESS;
  const privateKey = env.STANDX_WALLET_PRIVATE_KEY;

  console.log('═════════════════════════════════════════════════');
  console.log(`Testing: ${envFile}`);
  console.log('═════════════════════════════════════════════════');
  console.log(`Address: ${address}`);
  console.log(`Private Key: ${privateKey.substring(0, 10)}...${privateKey.substring(privateKey.length - 6)}`);
  console.log('');

  // Initialize auth (exact class from docs)
  const auth = new StandXAuthDocs();

  // Setup wallet (exact code from docs)
  const wallet = new ethers.Wallet(privateKey);

  console.log(`Wallet address: ${wallet.address}`);
  console.log(`Request ID: ${auth['requestId']}`);
  console.log('');

  // Authenticate (exact method from docs)
  try {
    const loginResponse = await auth.authenticate(
      'bsc',
      wallet.address,
      async (message) => wallet.signMessage(message)
    );

    console.log('✅ AUTH SUCCESSFUL!');
    console.log('═════════════════════════════════════════════════');
    console.log(`Token: ${loginResponse.token.substring(0, 30)}...${loginResponse.token.substring(loginResponse.token.length - 20)}`);
    console.log(`Address: ${loginResponse.address}`);
    console.log(`Chain: ${loginResponse.chain}`);
    if (loginResponse.alias) console.log(`Alias: ${loginResponse.alias}`);
    console.log('═════════════════════════════════════════════════');

    return loginResponse;
  } catch (error: any) {
    console.log('');
    console.error('❌ AUTH FAILED');
    console.error('═════════════════════════════════════════════════');
    console.error(`Error: ${error.message}`);
    if (error.response?.data) {
      console.error(`API Response:`, JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// Run
const envFile = process.argv[2] || '.env';

testAuth(envFile).catch((error) => {
  process.exit(1);
});
