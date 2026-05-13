// ─── @pollar/pay — PollarPayClient ───────────────────────────────────────────
// Main client class for accepting USDC payments on Stellar.
//
// Design decisions:
//   - Uses native `fetch` instead of axios to match @pollar/core's zero-dep approach
//   - Sends `x-pollar-api-key` header (same as @pollar/core) for authentication
//   - Auto-resolves baseUrl from the apiKey prefix (pub_testnet_ → testnet API)
//   - All methods throw PollarPayError with typed error codes
//
// This client is framework-agnostic — works in Node.js, browsers, and edge runtimes.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  PayIntentResponse,
  PayStatusResponse,
  PayStatusData,
  PaymentCallbacks,
  PollarPayConfig,
  PayManualCompleteResponse,
} from './types';
import { FINAL_STATUSES, PollarPayError, PAY_ERROR_CODES } from './types';

/** Default polling interval for `waitForPayment()`. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Default base URLs by environment. */
const BASE_URLS: Record<string, string> = {
  testnet: 'https://pay.api.pollar.xyz/api',
  mainnet: 'https://pay.api.pollar.xyz/api',
  local: 'http://localhost:3000/api',
};

/**
 * Resolves the backend URL from the apiKey prefix or explicit config.
 *
 * Key prefixes:
 *   - `pub_testnet_xxx` → testnet
 *   - `pub_mainnet_xxx` → mainnet
 *   - anything else     → local (development)
 */
function resolveBaseUrl(config: PollarPayConfig): string {
  if (config.baseUrl) return config.baseUrl;

  if (config.apiKey.startsWith('pub_mainnet_')) return BASE_URLS.mainnet!;
  if (config.apiKey.startsWith('pub_testnet_')) return BASE_URLS.testnet!;

  return BASE_URLS.local!;
}

/**
 * PollarPayClient — Accept USDC payments on Stellar.
 *
 * This client communicates with the Pollar Pay backend to create payment intents,
 * check payment status, and poll for completion. It uses the same publishable API key
 * (`pub_testnet_xxx` / `pub_mainnet_xxx`) that you already use with `@pollar/core`.
 *
 * @example
 * ```typescript
 * import { PollarPayClient } from '@pollar/pay';
 *
 * const pay = new PollarPayClient({
 *   apiKey: 'pub_testnet_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
 * });
 *
 * // Create a payment intent for 25 USDC
 * const intent = await pay.createIntent(25.00);
 * console.log(intent.data.wallet_address); // Stellar address for QR code
 * console.log(intent.data.transaction_id); // Use for status polling
 *
 * // Poll until completed
 * const stop = pay.waitForPayment(intent.data.transaction_id, {
 *   onCompleted: (status) => console.log('Paid!', status),
 *   onFailed: (status) => console.log('Failed:', status.status),
 * });
 *
 * // Call stop() to cancel polling manually
 * ```
 */
export class PollarPayClient {
  /** The publishable API key used for authentication. */
  readonly apiKey: string;

  /** Resolved backend URL. */
  private readonly _baseUrl: string;

  constructor(config: PollarPayConfig) {
    if (!config.apiKey) {
      throw new PollarPayError(PAY_ERROR_CODES.INVALID_API_KEY, 'apiKey is required');
    }

    this.apiKey = config.apiKey;
    this._baseUrl = resolveBaseUrl(config);
  }

  // ─── Create Intent ──────────────────────────────────────────────────────────

  /**
   * Creates a new payment intent.
   *
   * This locks a wallet from the pool for 15 minutes and returns a Stellar
   * address where the customer should send USDC. The wallet is automatically
   * released after the timer expires or when payment is detected.
   *
   * @param amount — USDC amount to charge (0.01 – 1,000,000).
   * @param reason — The purpose or reason for the payment intent.
   * @returns Payment intent with `transaction_id`, `wallet_address`, and `expires_at`.
   * @throws {PollarPayError} `INVALID_AMOUNT` if amount is out of range.
   * @throws {PollarPayError} `NO_WALLETS_AVAILABLE` if all pool wallets are locked.
   * @throws {PollarPayError} `INVALID_API_KEY` if the API key is not valid.
   */
  async createIntent(amount: number | string, reason: string): Promise<PayIntentResponse> {
    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

    if (isNaN(parsedAmount) || parsedAmount < 0.01 || parsedAmount > 1_000_000) {
      throw new PollarPayError(
        PAY_ERROR_CODES.INVALID_AMOUNT,
        'Amount must be between 0.01 and 1,000,000 USDC',
      );
    }

    return this._request<PayIntentResponse>('POST', '/sdk/pay', {
      amount_expected: parsedAmount.toString(),
      reason: reason,
    });
  }

  // ─── Check Status ───────────────────────────────────────────────────────────

  /**
   * Checks the current status of a payment intent.
   *
   * @param transactionId — The `transaction_id` returned by `createIntent()`.
   * @returns Current payment status including `amount_paid`, `remaining`, and `time_remaining_seconds`.
   * @throws {PollarPayError} `TRANSACTION_NOT_FOUND` if the transaction does not exist.
   */
  async checkStatus(transactionId: string): Promise<PayStatusResponse> {
    if (!transactionId) {
      throw new PollarPayError(
        PAY_ERROR_CODES.TRANSACTION_NOT_FOUND,
        'transactionId is required',
      );
    }

    const params = new URLSearchParams({ transaction_id: transactionId });
    return this._request<PayStatusResponse>('GET', `/sdk/status?${params.toString()}`);
  }

  // ─── Manual Complete ────────────────────────────────────────────────────────

  /**
   * Manually mark a payment intent as completed.
   * Useful when a payment is settled off-chain (e.g. in cash).
   *
   * @param transactionId — The `transaction_id` returned by `createIntent()`.
   * @returns Success response.
   */
  async manualComplete(transactionId: string): Promise<PayManualCompleteResponse> {
    if (!transactionId) {
      throw new PollarPayError(
        PAY_ERROR_CODES.TRANSACTION_NOT_FOUND,
        'transactionId is required',
      );
    }

    return this._request<PayManualCompleteResponse>('POST', '/sdk/manual-complete', {
      transaction_id: transactionId,
    });
  }

  // ─── Wait for Payment (polling) ─────────────────────────────────────────────

  /**
   * Polls for payment status updates with callbacks.
   *
   * Automatically stops polling when the transaction reaches a final state.
   * Returns a `stop()` function to cancel polling manually.
   *
   * @param transactionId — The `transaction_id` from `createIntent()`.
   * @param callbacks — `onUpdate`, `onCompleted`, `onOverpaid`, `onFailed`, `onError`.
   * @param intervalMs — Polling interval in milliseconds. Default: `5000` (5 seconds).
   * @returns A function that stops polling when called.
   *
   * @example
   * ```typescript
   * const stop = pay.waitForPayment(transactionId, {
   *   onUpdate: (s) => console.log(`Status: ${s.status}, paid: ${s.amount_paid}`),
   *   onCompleted: (s) => console.log('Payment completed!'),
   *   onFailed: (s) => console.log(`Payment failed: ${s.status}`),
   *   onError: (e) => console.error('Polling error:', e.message),
   * });
   *
   * // To stop polling early:
   * stop();
   * ```
   */
  waitForPayment(
    transactionId: string,
    callbacks: PaymentCallbacks,
    intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ): () => void {
    let stopped = false;

    const poll = async (): Promise<void> => {
      if (stopped) return;

      try {
        const result = await this.checkStatus(transactionId);
        const data: PayStatusData = result.data;

        callbacks.onUpdate?.(data);

        if (data.status === 'completed') {
          callbacks.onCompleted?.(data);
          stopped = true;
          return;
        }

        if (data.status === 'overpaid') {
          callbacks.onOverpaid?.(data);
          stopped = true;
          return;
        }

        if (FINAL_STATUSES.includes(data.status) || data.is_expired) {
          callbacks.onFailed?.(data);
          stopped = true;
          return;
        }

        // Schedule next poll
        setTimeout(poll, intervalMs);
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(err);

        // Continue polling on error (transient failures)
        if (!stopped) setTimeout(poll, intervalMs);
      }
    };

    // Start first poll immediately
    poll();

    return () => {
      stopped = true;
    };
  }

  // ─── Internal HTTP ──────────────────────────────────────────────────────────

  /**
   * Makes an authenticated request to the Pollar Pay backend.
   * Sends `x-pollar-api-key` header — same as @pollar/core.
   */
  private async _request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this._baseUrl}${path}`;

    const headers: Record<string, string> = {
      'x-pollar-api-key': this.apiKey,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err: unknown) {
      throw new PollarPayError(
        PAY_ERROR_CODES.NETWORK_ERROR,
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const data = await response.json() as T & { error?: string };

    if (!response.ok) {
      const errorMessage = data.error ?? `HTTP ${response.status}`;

      if (response.status === 401) {
        throw new PollarPayError(PAY_ERROR_CODES.INVALID_API_KEY, errorMessage);
      }
      if (response.status === 404) {
        throw new PollarPayError(PAY_ERROR_CODES.TRANSACTION_NOT_FOUND, errorMessage);
      }
      if (response.status === 503) {
        throw new PollarPayError(PAY_ERROR_CODES.NO_WALLETS_AVAILABLE, errorMessage);
      }

      throw new PollarPayError(PAY_ERROR_CODES.NETWORK_ERROR, errorMessage);
    }

    return data;
  }
}
