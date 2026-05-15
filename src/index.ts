// ─── @pollar/pay — Public API ────────────────────────────────────────────────
// Todo lo que se exporta acá es parte de la API pública del SDK.
// ─────────────────────────────────────────────────────────────────────────────

export { PollarPayClient } from './client';

export type {
    PollarPayConfig,
    PayIntentResponse,
    PayIntentData,
    PayStatusResponse,
    PayStatusData,
    PayManualCompleteResponse,
    PaymentStatus,
    PaymentCallbacks,
    WaitForPaymentOptions,
    PayErrorCode,
    StellarNetwork,
} from './types';

export { PAY_ERROR_CODES, FINAL_STATUSES, PollarPayError } from './types';

export {
    buildSep7PayUri,
    buildStellarExpertTxUrl,
    buildStellarExpertAccountUrl,
    networkFromApiKey,
    normalizeNetwork,
    USDC_ISSUERS,
    NETWORK_PASSPHRASES,
} from './stellar';
