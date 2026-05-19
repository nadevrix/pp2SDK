// ─── @pollar/pay — PollarPayClient ───────────────────────────────────────────
// Cliente principal para aceptar pagos en USDC sobre Stellar.
//
// Diseño:
//   - `fetch` nativo, sin dependencias externas → corre en Node, browser y edge
//   - Header `x-pollar-api-key` para autenticación
//   - El baseUrl se autoresuelve a partir del prefijo de la apiKey
//   - Todos los métodos arrojan `PollarPayError` con un `code` tipado
// ─────────────────────────────────────────────────────────────────────────────

import type {
    PayIntentResponse,
    PayStatusResponse,
    PayStatusData,
    PaymentCallbacks,
    PollarPayConfig,
    PayManualCompleteResponse,
    WaitForPaymentOptions,
    StellarNetwork,
} from './types';
import { FINAL_STATUSES, PollarPayError, PAY_ERROR_CODES } from './types';
import { networkFromApiKey } from './stellar';

/** Intervalo por defecto de `waitForPayment()`. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

// Hoy Pollar Pay corre solo en TESTNET. Cuando lancemos mainnet, agregamos
// `mainnet` en este mapa y enriquecemos `resolveBaseUrl` para distinguir por
// prefijo de apiKey. Mientras tanto, si llega una key `pub_mainnet_*`,
// preferimos fallar explícito antes que apuntarla al backend de testnet por
// inercia.
const TESTNET_BASE_URL = 'https://pp1back.vercel.app/api';
const LOCAL_BASE_URL = 'http://localhost:3000/api';

function resolveBaseUrl(config: PollarPayConfig): string {
    if (config.baseUrl) return config.baseUrl;

    if (config.apiKey.startsWith('pub_mainnet_')) {
        throw new PollarPayError(
            PAY_ERROR_CODES.INVALID_API_KEY,
            'Mainnet API keys aún no están soportadas. Pasá `baseUrl` explícito si querés apuntar a un backend custom.',
        );
    }
    if (config.apiKey.startsWith('pub_testnet_')) return TESTNET_BASE_URL;

    // Sin prefijo conocido → asumimos desarrollo local.
    return LOCAL_BASE_URL;
}

/**
 * `PollarPayClient` — Cobrá USDC sobre Stellar.
 *
 * Maneja todo el ciclo de un cobro: crear intent, consultar estado, esperar
 * pago con polling, cerrar manualmente.
 *
 * @example
 * ```ts
 * import { PollarPayClient, buildSep7PayUri } from '@pollar/pay';
 *
 * const pay = new PollarPayClient({
 *   apiKey: 'pub_testnet_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
 * });
 *
 * // 1. Crear un cobro de 25 USDC
 * const intent = await pay.createIntent(25, 'Pedido #1234');
 *
 * // 2. Mostrar el QR con la URI SEP-7 que cualquier wallet entiende
 * const uri = buildSep7PayUri(intent.data);
 *
 * // 3. Esperar a que el cliente pague
 * pay.waitForPayment(intent.data.transaction_id, {
 *   onCompleted: (s) => console.log('Pagado:', s.amount_paid, 'USDC'),
 *   onFailed:    (s) => console.log('No completado:', s.status),
 * });
 * ```
 */
export class PollarPayClient {
    /** API key publishable que se usa para autenticarse. */
    readonly apiKey: string;

    /** Red Stellar derivada de la apiKey (`TESTNET` o `MAINNET`). */
    readonly network: StellarNetwork;

    /** URL del backend resuelta. */
    private readonly _baseUrl: string;

    constructor(config: PollarPayConfig) {
        if (!config.apiKey) {
            throw new PollarPayError(PAY_ERROR_CODES.INVALID_API_KEY, 'apiKey is required');
        }

        this.apiKey = config.apiKey;
        this.network = networkFromApiKey(config.apiKey);
        this._baseUrl = resolveBaseUrl(config);
    }

    // ─── Crear cobro ────────────────────────────────────────────────────────

    /**
     * Crea un nuevo cobro.
     *
     * Lockea una wallet del pool por 15 minutos y devuelve la dirección Stellar
     * donde el cliente debe enviar los USDC. La wallet se libera automáticamente
     * cuando el timer vence o cuando se detecta el pago.
     *
     * @param amount Monto USDC a cobrar (0.01 – 1,000,000).
     * @param reason Descripción del cobro (aparece en el dashboard del comercio).
     *
     * @throws {PollarPayError} `INVALID_AMOUNT` si el monto está fuera de rango.
     * @throws {PollarPayError} `NO_WALLETS_AVAILABLE` si el pool está lleno.
     * @throws {PollarPayError} `INVALID_API_KEY` si la API key es inválida.
     */
    async createIntent(amount: number | string, reason: string): Promise<PayIntentResponse> {
        const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

        if (isNaN(parsedAmount) || parsedAmount < 0.01 || parsedAmount > 1_000_000) {
            throw new PollarPayError(
                PAY_ERROR_CODES.INVALID_AMOUNT,
                'Amount must be between 0.01 and 1,000,000 USDC',
            );
        }

        if (!reason || !reason.trim()) {
            throw new PollarPayError(
                PAY_ERROR_CODES.INVALID_AMOUNT,
                'reason is required (1+ char)',
            );
        }

        return this._request<PayIntentResponse>('POST', '/sdk/pay', {
            amount_expected: parsedAmount.toString(),
            reason: reason.trim(),
        });
    }

    // ─── Consultar estado ──────────────────────────────────────────────────

    /**
     * Consulta el estado actual de un cobro.
     *
     * Si la transacción está `pending`, el backend dispara una verificación
     * on-chain inmediata. Es decir: cada `checkStatus()` no solo lee la DB,
     * también pregunta a Horizon. Por eso `waitForPayment()` con polling
     * funciona aún sin SSE.
     *
     * @param transactionId El `transaction_id` devuelto por `createIntent()`.
     *
     * @throws {PollarPayError} `TRANSACTION_NOT_FOUND` si el cobro no existe.
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

    // ─── Cerrar manualmente ─────────────────────────────────────────────────

    /**
     * Marca un cobro como cerrado manualmente. Útil cuando el cliente paga en
     * efectivo y querés reflejarlo en el dashboard.
     *
     * Si llegaron fondos parciales on-chain antes del cierre manual, el backend
     * los reenvía al `payout_wallet` del comercio antes de cerrar la tx.
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

    // ─── waitForPayment ─────────────────────────────────────────────────────

    /**
     * Polea el estado de un cobro y dispara callbacks cuando cambia.
     *
     * Se detiene solo cuando el cobro alcanza un estado final, cuando se
     * cumple `options.maxWaitMs`, o cuando hay demasiados errores
     * consecutivos. Devuelve una función `stop()` para cancelar manualmente.
     *
     * Los callbacks pueden ser async — el SDK awaitea las promesas, así que
     * podés hacer `await sendEmail(s)` dentro de `onCompleted` con seguridad.
     *
     * Los errores aplican backoff exponencial (5s → 10s → 20s → 40s, tope 60s)
     * y se rinden después de `maxConsecutiveErrors`.
     *
     * @example
     * ```ts
     * const stop = pay.waitForPayment(transactionId, {
     *   onUpdate:    (s) => console.log('paid:', s.amount_paid),
     *   onCompleted: async (s) => { await fulfillOrder(s); },
     *   onOverpaid:  (s) => console.log('overpaid:', s.amount_paid),
     *   onFailed:    (s) => console.log('failed:', s.status),
     *   onError:     (e) => console.error(e.message),
     *   onTimeout:   ()  => console.log('took too long'),
     * }, { intervalMs: 5000, maxWaitMs: 16 * 60 * 1000 });
     * ```
     */
    waitForPayment(
        transactionId: string,
        callbacks: PaymentCallbacks,
        options: number | WaitForPaymentOptions = {},
    ): () => void {
        // Compat: la 3ra arg solía ser solo intervalMs.
        const opts: WaitForPaymentOptions =
            typeof options === 'number' ? { intervalMs: options } : options;

        const intervalMs           = opts.intervalMs           ?? DEFAULT_POLL_INTERVAL_MS;
        const maxWaitMs            = opts.maxWaitMs            ?? 16 * 60 * 1000;
        const maxConsecutiveErrors = opts.maxConsecutiveErrors ?? 5;

        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const startedAt = Date.now();
        let consecutiveErrors = 0;

        const stop = () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        };

        const poll = async (): Promise<void> => {
            if (stopped) return;

            if (Date.now() - startedAt >= maxWaitMs) {
                stopped = true;
                await callbacks.onTimeout?.();
                return;
            }

            try {
                const result = await this.checkStatus(transactionId);
                const data: PayStatusData = result.data;
                consecutiveErrors = 0;

                await callbacks.onUpdate?.(data);

                if (data.status === 'completed') {
                    await callbacks.onCompleted?.(data);
                    stopped = true;
                    return;
                }

                if (data.status === 'overpaid') {
                    await callbacks.onOverpaid?.(data);
                    stopped = true;
                    return;
                }

                if (FINAL_STATUSES.includes(data.status) || data.is_expired) {
                    await callbacks.onFailed?.(data);
                    stopped = true;
                    return;
                }

                timer = setTimeout(poll, intervalMs);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                consecutiveErrors += 1;
                await callbacks.onError?.(err);

                if (consecutiveErrors >= maxConsecutiveErrors) {
                    stopped = true;
                    await callbacks.onTimeout?.();
                    return;
                }

                const backoff = Math.min(intervalMs * 2 ** (consecutiveErrors - 1), 60_000);
                if (!stopped) timer = setTimeout(poll, backoff);
            }
        };

        poll();
        return stop;
    }

    // ─── HTTP interno ───────────────────────────────────────────────────────

    /**
     * Hace una request autenticada al backend Pollar Pay. Manda el header
     * `x-pollar-api-key` que es lo que el backend lee para autenticar.
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

        const data = (await response.json()) as T & { error?: string };

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
