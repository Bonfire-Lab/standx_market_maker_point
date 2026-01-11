#!/usr/bin/env tsx
/**
 * Test StandX auth from .env files
 */

import fs from 'fs';
import path from 'path';

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

async function testAuth(envFile: string) {
  const envPath = path.join(process.cwd(), envFile);
  console.log('═════════════════════════════════════════════════');
  console.log(`Testing: ${envFile}`);
  console.log('═════════════════════════════════════════════════');

  const env = parseEnvFile(envPath);
  const address = env.STANDX_WALLET_ADDRESS;
  const privateKey = env.STANDX_WALLET_PRIVATE_KEY;

  if (!address || !privateKey) {
    console.error('❌ Missing credentials in env file');
    process.exit(1);
  }

  console.log(`Address:    ${address}`);
  console.log(`Private Key: ${privateKey.substring(0, 10)}...${privateKey.substring(privateKey.length - 6)}`);
  console.log('');

  // Import dependencies
  const axios = (await import('axios')).default;
  const { ed25519 } = await import('@noble/curves/ed25519');
  const { base58 } = await import('@scure/base');
  const { ethers } = await import('ethers');

  // Verify address matches private key
  const wallet = new ethers.Wallet(privateKey);
  console.log(`Derived Address: ${wallet.address}`);
  if (wallet.address.toLowerCase() !== address.toLowerCase()) {
    console.error('❌ Address mismatch!');
    process.exit(1);
  }
  console.log('✅ Address matches');
  console.log('');

  // Generate Ed25519 key pair
  const ed25519PrivateKey = ed25519.utils.randomPrivateKey();
  const ed25519PublicKey = ed25519.getPublicKey(ed25519PrivateKey);
  const requestId = base58.encode(ed25519PublicKey);

  console.log(`Request ID: ${requestId}`);
  console.log('');

  // Step 1: Prepare signin
  console.log('Step 1: Prepare signin...');
  const prepareResponse = await axios.post(
    `https://api.standx.com/v1/offchain/prepare-signin?chain=bsc`,
    { address, requestId }
  );

  console.log(`  Status: ${prepareResponse.status}`);
  if (!prepareResponse.data.success) {
    console.error('❌ Prepare signin failed');
    console.error(JSON.stringify(prepareResponse.data, null, 2));
    process.exit(1);
  }
  console.log('✅ Prepare signin success');
  console.log('');

  // Step 2: Parse JWT and sign
  console.log('Step 2: Parse and sign message...');
  const signedData = prepareResponse.data.signedData;
  const jwtParts = signedData.split('.');
  const jwtPayload = JSON.parse(
    Buffer.from(jwtParts[1], 'base64url').toString('utf-8')
  );
  const messageToSign = jwtPayload.message;

  console.log('----- FULL MESSAGE TO SIGN -----');
  console.log(messageToSign);
  console.log('----- END OF MESSAGE -----');
  console.log('');

  const signature = await wallet.signMessage(messageToSign);
  console.log(`Signature: ${signature}`);
  console.log('');

  // Step 3: Login
  console.log('Step 3: Login...');
  const loginResponse = await axios.post(
    `https://api.standx.com/v1/offchain/login?chain=bsc`,
    {
      signature,
      signedData,
      expiresSeconds: 604800
    }
  );

  console.log(`  Status: ${loginResponse.status}`);

  if (!loginResponse.data.token) {
    console.error('❌ No token in response');
    console.error(JSON.stringify(loginResponse.data, null, 2));
    process.exit(1);
  }

  const token = loginResponse.data.token;
  console.log('✅ Login successful!');
  console.log('');
  console.log('═════════════════════════════════════════════════');
  console.log(`✅ AUTH SUCCESS!`);
  console.log('═════════════════════════════════════════════════');
  console.log(`Token: ${token.substring(0, 30)}...${token.substring(token.length - 20)}`);
}

const envFile = process.argv[2] || '.env';

testAuth(envFile).catch((error) => {
  console.error('');
  console.error('═════════════════════════════════════════════════');
  console.error(`❌ AUTH FAILED`);
  console.error('═════════════════════════════════════════════════');
  console.error(`Error: ${error.message}`);
  if (error.response?.data) {
    console.error(`API Response:`, JSON.stringify(error.response.data, null, 2));
  }
  process.exit(1);
});
