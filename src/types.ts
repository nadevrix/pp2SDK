// ─── @pollar/pay — Type definitions ──────────────────────────────────────────
// Tipos públicos del SDK. Quedan centralizados acá para que el cliente y los
// helpers compartan la misma forma exacta.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Red Stellar sobre la que se va a operar. El SDK la deduce del prefijo de la
 * `apiKey` (`pub_testnet_…` → TESTNET, `pub_mainnet_…` → MAINNET), pero también
 * la podés leer de cualquier intent o status devuelto por el backend.
 */
export type StellarNetwork = 'TESTNET' | 'MAINNET';

/**
 * Configuración del `PollarPayClient`.
 *
 * El único campo obligatorio es `apiKey`. Todo lo demás se autoresuelve.
 *
 * @example
 * ```ts
 * const pay = new PollarPayClient({
 *   apiKey: 'pub_testnet_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
 * });
 * ```
 */
export interface PollarPayConfig {
    /** API key publishable del comercio (`pub_testnet_…` o `pub_mainnet_…`). */
    apiKey: string;

    /**
     * Override de la URL del backend Pollar Pay. Por defecto se resuelve a la
     * API hosteada. Usá `http://localhost:3000/api` para desarrollo local.
     */
    baseUrl?: string;
}

// ─── Payment Intent ─────────────────────────────────────────────────────────

/** Respuesta exitosa de `createIntent()`. */
export interface PayIntentResponse {
    success: true;
    data: PayIntentData;
}

/** Información del cobro recién creado. */
export interface PayIntentData {
    /** ID único del cobro. Usalo en `checkStatus()` y `waitForPayment()`. */
    transaction_id: string;

    /** Wallet Stellar destino al que el cliente envía los USDC. */
    wallet_address: string;

    /** Razón / motivo del cobro (lo que se muestra en el dashboard). */
    reason: string;

    /** Monto en USDC que el cliente tiene que pagar (string para no perder precisión). */
    amount: string;

    /** Asset code — actualmente siempre `USDC`. */
    asset: string;

    /** Timestamp ISO 8601 de expiración (15 minutos desde la creación). */
    expires_at: string;

    /** Red Stellar (`TESTNET` o `MAINNET`). */
    network: StellarNetwork;
}

// ─── Payment Status ─────────────────────────────────────────────────────────

/**
 * Estados posibles de un cobro.
 *
 * | Status         | Cuándo ocurre                                              |
 * |----------------|------------------------------------------------------------|
 * | `pending`      | Esperando que el cliente pague                             |
 * | `completed`    | Monto exacto (o más) recibido, fondos enviados al comercio |
 * | `overpaid`     | El cliente pagó más de lo esperado                         |
 * | `underpaid`    | Venció el timer con pago parcial                           |
 * | `expired`      | Venció el timer sin ningún pago                            |
 * | `refunded`     | Admin emitió un reembolso desde treasury                   |
 * | `anomaly`      | Forward falló o error inesperado — requiere revisión       |
 * | `late_anomaly` | Reservado para casos edge (actualmente no se asigna)       |
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

/** Estados que indican que el flujo terminó (no va a haber más updates). */
export const FINAL_STATUSES: readonly PaymentStatus[] = [
    'completed',
    'overpaid',
    'expired',
    'underpaid',
    'refunded',
    'anomaly',
    'late_anomaly',
] as const;

/** Respuesta exitosa de `checkStatus()`. */
export interface PayStatusResponse {
    success: true;
    data: PayStatusData;
}

/** Información detallada del estado del cobro. */
export interface PayStatusData {
    /** ID del cobro. */
    transaction_id: string;

    /** Estado actual. */
    status: PaymentStatus;

    /** Monto original solicitado, en USDC (string). */
    amount_expected: string;

    /** Motivo del cobro. */
    reason?: string;

    /** Total USDC detectado on-chain hasta ahora. */
    amount_paid: string;

    /** Saldo restante para cerrar el cobro (`max(0, expected - paid)`). */
    remaining: string;

    /** Asset code (`USDC`). */
    asset: string;

    /** Wallet Stellar asignada a este cobro. */
    wallet_address: string;

    /** Timestamp ISO 8601 de expiración. */
    expires_at: string;

    /** Segundos restantes hasta la expiración. `0` si ya expiró. */
    time_remaining_seconds: number;

    /** Si el timer del cobro ya venció. */
    is_expired: boolean;

    /** Timestamp ISO 8601 de creación. */
    created_at: string;

    /**
     * Fee de Pollar Pay aplicado al cobro (en USDC). Solo viene cuando el
     * cobro alcanza un estado final con `forward_status='completed'`.
     */
    fee_amount?: string;

    /**
     * Monto neto que llegó a la wallet del comercio (gross − fee). Solo viene
     * cuando el cobro tiene `forward_status='completed'`.
     */
    payout_amount?: string;

    /** `true` si la tx entró dentro de las 50 transacciones gratuitas del plan Free. */
    is_free_tx?: boolean;

    /** Estado del forward de fondos al `payout_wallet` del comercio. */
    forward_status?: 'pending' | 'completed' | 'failed' | 'skipped';

    /** Hash Stellar del forward al comercio. Útil para construir un link a Stellar Expert. */
    forward_tx_hash?: string;

    /** Info de contacto de soporte — solo viene en estados de anomalía / overpaid. */
    support?: {
        contact: string;
        message: string;
    };
}

// ─── Manual Completion ──────────────────────────────────────────────────────

/** Respuesta exitosa de `manualComplete()`. */
export interface PayManualCompleteResponse {
    success: true;
    message: string;
    forwarded_amount?: string | null;
    forward_status?: 'completed' | 'failed' | 'skipped';
    forward_tx_hash?: string | null;
}

// ─── Callbacks para waitForPayment() ────────────────────────────────────────

/**
 * Callbacks para `waitForPayment()`.
 *
 * Todos los callbacks pueden devolver `void` o `Promise<void>` — el SDK awaitea
 * promesas, así que podés hacer trabajo async como `await sendEmail(status)`
 * dentro de `onCompleted` y confiar en que terminó antes del siguiente evento.
 */
export interface PaymentCallbacks {
    /** Se llama en cada poll con el último estado. */
    onUpdate?: (status: PayStatusData) => void | Promise<void>;

    /** Se llama una vez cuando el cobro alcanza `completed`. */
    onCompleted?: (status: PayStatusData) => void | Promise<void>;

    /** Se llama una vez cuando el cobro alcanza `overpaid`. */
    onOverpaid?: (status: PayStatusData) => void | Promise<void>;

    /**
     * Se llama una vez cuando el cobro alcanza un estado final distinto de
     * `completed`/`overpaid` (`expired`, `underpaid`, `anomaly`, etc.).
     */
    onFailed?: (status: PayStatusData) => void | Promise<void>;

    /** Se llama si un poll falla (la rotación sigue con backoff exponencial). */
    onError?: (error: Error) => void | Promise<void>;

    /**
     * Se llama si `maxWaitMs` se cumple o se alcanzan demasiados errores
     * consecutivos. Útil para mostrar un UI tipo "el cobro tardó demasiado".
     */
    onTimeout?: () => void | Promise<void>;
}

// ─── Opciones para waitForPayment() ─────────────────────────────────────────

/** Opciones que controlan cómo polea `waitForPayment()`. */
export interface WaitForPaymentOptions {
    /** Intervalo de polling en ms. Default: `5000` (5 segundos). */
    intervalMs?: number;

    /**
     * Tiempo máximo total que vamos a polear (ms).
     * Default: `16 * 60 * 1000` (1 minuto después de que expira el intent).
     * Al llegar al máximo, llamamos a `onTimeout` y paramos.
     */
    maxWaitMs?: number;

    /**
     * Cantidad de errores consecutivos antes de rendirse.
     * Default: `5`. Cada error aplica backoff exponencial (5s → 10s → 20s → 40s, tope 60s).
     */
    maxConsecutiveErrors?: number;
}

// ─── Error ──────────────────────────────────────────────────────────────────

/** Códigos de error que arroja el SDK. */
export const PAY_ERROR_CODES = {
    /** La API key es inválida o no tiene Pollar Pay habilitado. */
    INVALID_API_KEY: 'INVALID_API_KEY',
    /** El monto está fuera de rango (0.01 – 1,000,000 USDC). */
    INVALID_AMOUNT: 'INVALID_AMOUNT',
    /** Todas las wallets del pool están ocupadas. Reintentar en ~1 minuto. */
    NO_WALLETS_AVAILABLE: 'NO_WALLETS_AVAILABLE',
    /** El cobro consultado no existe. */
    TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
    /** Error de red o de servidor. */
    NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type PayErrorCode = (typeof PAY_ERROR_CODES)[keyof typeof PAY_ERROR_CODES];

/** Error que arrojan los métodos del `PollarPayClient`. */
export class PollarPayError extends Error {
    readonly code: PayErrorCode;

    constructor(code: PayErrorCode, message: string) {
        super(message);
        this.name = 'PollarPayError';
        this.code = code;
    }
}
