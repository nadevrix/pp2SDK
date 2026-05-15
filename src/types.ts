// ─── @pollar/pay — Type definitions ──────────────────────────────────────────
// All types used by PollarPayClient for payment intents, status polling,
// and callback-driven flows. Follows the same naming conventions as @pollar/core.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for the PollarPayClient.
 *
 * Uses the same `apiKey` (publishable key) that the merchant already has
 * from Pollar — no separate credentials required.
 *
 * @example
 * ```typescript
 * const pay = new PollarPayClient({
 *   apiKey: 'pub_testnet_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
 * });
 * ```
 */
export interface PollarPayConfig {
  /** Pollar publishable API key (`pub_testnet_xxx` or `pub_mainnet_xxx`). */
  apiKey: string;

  /**
   * Override the Pollar Pay backend URL.
   * Defaults to the hosted Pollar Pay API.
   * Use `http://localhost:3000/api` for local development.
   */
  baseUrl?: string;
}

// ─── Payment Intent ─────────────────────────────────────────────────────────

/** Successful response from `createIntent()`. */
export interface PayIntentResponse {
  success: true;
  data: PayIntentData;
}

/** Payment intent data returned after creating an intent. */
export interface PayIntentData {
  /** Unique ID for this payment intent. Use with `checkStatus()` and `waitForPayment()`. */
  transaction_id: string;

  /** Stellar public key where the customer should send USDC. */
  wallet_address: string;

  /** The reason or purpose for this payment intent. */
  reason: string;

  /** USDC amount the customer needs to pay. */
  amount: string;

  /** Asset code — always `USDC` currently. */
  asset: string;

  /** ISO 8601 timestamp when this payment intent expires (15 minutes from creation). */
  expires_at: string;

  /** Stellar network (`TESTNET` or `MAINNET`). */
  network: string;
}

// ─── Payment Status ─────────────────────────────────────────────────────────

/**
 * All possible statuses for a payment intent.
 *
 * | Status         | Meaning                                              |
 * |----------------|------------------------------------------------------|
 * | `pending`      | Waiting for payment from customer                    |
 * | `completed`    | Exact amount received, funds forwarded to merchant   |
 * | `overpaid`     | More than expected received (support contact included)|
 * | `underpaid`    | Timer expired with partial payment                   |
 * | `expired`      | Timer expired with zero payment                      |
 * | `refunded`     | Admin issued a refund from treasury                  |
 * | `anomaly`      | Forward failed or unexpected error (needs review)    |
 * | `late_anomaly` | Reserved for future edge cases                       |
 */
export type PaymentStatus =
  | 'pending'
  | 'completed'
  | 'overpaid'
  | 'underpaid'
  | 'expired'
  | 'refunded'
  | 'anomaly'
  | 'late_anomaly';

/** Statuses that indicate the payment flow has ended. */
export const FINAL_STATUSES: readonly PaymentStatus[] = [
  'completed',
  'overpaid',
  'expired',
  'underpaid',
  'refunded',
  'anomaly',
  'late_anomaly',
] as const;

/** Successful response from `checkStatus()`. */
export interface PayStatusResponse {
  success: true;
  data: PayStatusData;
}

/** Detailed payment status data. */
export interface PayStatusData {
  /** The payment intent ID. */
  transaction_id: string;

  /** Current status of the payment. */
  status: PaymentStatus;

  /** Original USDC amount requested. */
  amount_expected: string;

  /** The reason or purpose for this payment intent. */
  reason?: string;

  /** Total USDC received so far. */
  amount_paid: string;

  /** USDC remaining to complete payment (`max(0, expected - paid)`). */
  remaining: string;

  /** Asset code (`USDC`). */
  asset: string;

  /** Stellar wallet address assigned to this payment. */
  wallet_address: string;

  /** ISO 8601 expiration timestamp. */
  expires_at: string;

  /** Seconds remaining until expiration. `0` if expired. */
  time_remaining_seconds: number;

  /** Whether the payment timer has expired. */
  is_expired: boolean;

  /** ISO 8601 creation timestamp. */
  created_at: string;

  /** Support contact info — only present for anomaly statuses. */
  support?: {
    contact: string;
    message: string;
  };
}

// ─── Manual Completion ──────────────────────────────────────────────────────

/** Successful response from `manualComplete()`. */
export interface PayManualCompleteResponse {
  success: true;
  message: string;
}

// ─── Callbacks for waitForPayment() ─────────────────────────────────────────

/**
 * Callback functions for `waitForPayment()` polling.
 *
 * All callbacks may return `void` or a `Promise<void>` — the SDK awaits
 * promises so you can do async work like `await sendEmail(status)` inside
 * `onCompleted` and trust it finished before the next event.
 */
export interface PaymentCallbacks {
  /** Called on every poll with the latest status. */
  onUpdate?: (status: PayStatusData) => void | Promise<void>;

  /** Called once when payment reaches `completed` status. */
  onCompleted?: (status: PayStatusData) => void | Promise<void>;

  /** Called once when payment reaches `overpaid` status. */
  onOverpaid?: (status: PayStatusData) => void | Promise<void>;

  /**
   * Called once when payment reaches a terminal status
   * other than `completed` or `overpaid` (expired, underpaid, anomaly, etc.).
   */
  onFailed?: (status: PayStatusData) => void | Promise<void>;

  /** Called when a polling request fails. Polling continues with backoff. */
  onError?: (error: Error) => void | Promise<void>;

  /**
   * Called once when polling gives up because `maxWaitMs` was reached or
   * `maxConsecutiveErrors` was hit. Useful for showing a "took too long" UI.
   */
  onTimeout?: () => void | Promise<void>;
}

// ─── Options for waitForPayment() ───────────────────────────────────────────

/** Options controlling how `waitForPayment()` polls. */
export interface WaitForPaymentOptions {
  /** Polling interval in milliseconds. Default: `5000` (5 seconds). */
  intervalMs?: number;

  /**
   * Maximum total time to keep polling, in milliseconds.
   * Default: `16 * 60 * 1000` (1 min after intent expires).
   * When reached, `onTimeout` is called once and polling stops.
   */
  maxWaitMs?: number;

  /**
   * After this many consecutive errors, polling gives up.
   * Default: `5`. Each error applies exponential backoff (5s → 10s → 20s → 40s, capped at 60s).
   */
  maxConsecutiveErrors?: number;
}

// ─── Error ──────────────────────────────────────────────────────────────────

/** Error codes specific to Pollar Pay operations. */
export const PAY_ERROR_CODES = {
  /** The provided API key is invalid or does not have Pollar Pay enabled. */
  INVALID_API_KEY: 'INVALID_API_KEY',
  /** The amount is outside the allowed range (0.01 – 1,000,000 USDC). */
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  /** All pool wallets are currently in use. Retry in ~1 minute. */
  NO_WALLETS_AVAILABLE: 'NO_WALLETS_AVAILABLE',
  /** The requested transaction was not found. */
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  /** A network or server error occurred. */
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type PayErrorCode = (typeof PAY_ERROR_CODES)[keyof typeof PAY_ERROR_CODES];

/** Error thrown by PollarPayClient methods. */
export class PollarPayError extends Error {
  readonly code: PayErrorCode;

  constructor(code: PayErrorCode, message: string) {
    super(message);
    this.name = 'PollarPayError';
    this.code = code;
  }
}
