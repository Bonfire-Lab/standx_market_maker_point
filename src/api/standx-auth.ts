import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { ethers } from 'ethers';
import axios from 'axios';

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

export interface RequestSignatureHeaders {
  'x-request-sign-version': string;
  'x-request-id': string;
  'x-request-timestamp': string;
  'x-request-signature': string;
}

/**
 * StandX Authentication Helper
 * Based on: https://docs.standx.com/standx-api/perps-auth#complete-authentication-class-example
 */
export class StandXAuth {
  private ed25519PrivateKey: Uint8Array;
  private ed25519PublicKey: Uint8Array;
  private requestId: string;
  private baseUrl = 'https://api.standx.com';
  private accessToken: string | null = null;

  constructor() {
    // Generate Ed25519 key pair (exact method from StandX docs)
    const privateKey = ed25519.utils.randomSecretKey();
    this.ed25519PrivateKey = privateKey;
    this.ed25519PublicKey = ed25519.getPublicKey(privateKey);
    this.requestId = base58.encode(this.ed25519PublicKey);
  }

  /**
   * Authenticate with wallet address and signing callback
   * This is the main method from StandX docs
   */
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

  /**
   * Legacy login method for backward compatibility
   * Sets up wallet internally and calls authenticate
   */
  async loginWithPrivateKey(privateKey: string, chain: Chain = 'bsc'): Promise<string> {
    const wallet = new ethers.Wallet(privateKey);
    const response = await this.authenticate(chain, wallet.address, async (message) =>
      wallet.signMessage(message)
    );
    this.accessToken = response.token;
    return response.token;
  }

  /**
   * Prepare sign-in - get signed data from server
   */
  private async prepareSignIn(chain: Chain, address: string): Promise<string> {
    const res = await axios.post(
      `${this.baseUrl}/v1/offchain/prepare-signin?chain=${chain}`,
      { address, requestId: this.requestId },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const data = res.data;
    if (!data.success) {
      throw new Error(`Prepare signin failed: ${JSON.stringify(data)}`);
    }
    return data.signedData;
  }

  /**
   * Login with signature and signedData
   */
  private async login(
    chain: Chain,
    signature: string,
    signedData: string,
    expiresSeconds: number = 604800 // default: 7 days
  ): Promise<LoginResponse> {
    const res = await axios.post(
      `${this.baseUrl}/v1/offchain/login?chain=${chain}`,
      {
        signature,
        signedData,
        expiresSeconds,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!res.data.token) {
      throw new Error('No token in login response');
    }

    return res.data;
  }

  /**
   * Sign request payload with Ed25519
   * Returns headers for authenticated requests
   */
  signRequest(payload: string, requestId: string, timestamp: number): RequestSignatureHeaders {
    const version = 'v1';
    const message = `${version},${requestId},${timestamp},${payload}`;
    const messageBytes = Buffer.from(message, 'utf-8');
    const signature = ed25519.sign(messageBytes, this.ed25519PrivateKey);

    return {
      'x-request-sign-version': version,
      'x-request-id': requestId,
      'x-request-timestamp': timestamp.toString(),
      'x-request-signature': Buffer.from(signature).toString('base64'),
    };
  }

  /**
   * Parse JWT payload (exact method from StandX docs)
   */
  private parseJwt<T>(token: string): T {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
  }

  /**
   * Get current access token
   */
  getAccessToken(): string {
    if (!this.accessToken) {
      throw new Error('Not logged in. Call loginWithPrivateKey() first.');
    }
    return this.accessToken;
  }

  /**
   * Get request ID
   */
  getRequestId(): string {
    return this.requestId;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }
}
