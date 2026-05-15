// ─── @pollar/pay — Public API ────────────────────────────────────────────────
// Everything exported from this file is part of the public API.
// Follow the same export pattern as @pollar/core/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

export { PollarPayClient } from './client';

export type {
  PollarPayConfig,
  PayIntentResponse,
  PayIntentData,
  PayStatusResponse,
  PayStatusData,
  PaymentStatus,
  PaymentCallbacks,
  WaitForPaymentOptions,
  PayErrorCode,
} from './types';

export { PAY_ERROR_CODES, FINAL_STATUSES, PollarPayError } from './types';
