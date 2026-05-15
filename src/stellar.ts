// ─── @pollar/pay — Helpers Stellar ───────────────────────────────────────────
// Funciones puras que arman URIs SEP-7 y links a Stellar Expert. Cero
// dependencias para que funcionen en browser, Node y edge runtimes.
//
// Estos helpers son lo que el comercio terminaba escribiendo a mano. Vivirlos
// dentro del SDK garantiza que la URI sea siempre válida y consistente con la
// red del intent.
// ─────────────────────────────────────────────────────────────────────────────

import type { PayIntentData, StellarNetwork } from './types';

/** Issuers oficiales del USDC en Stellar. */
export const USDC_ISSUERS: Record<StellarNetwork, string> = {
    MAINNET: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    TESTNET: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

/** Network passphrases oficiales de Stellar. */
export const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
    MAINNET: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
};

/**
 * Normaliza un input arbitrario a `StellarNetwork`. Útil cuando el dato viene
 * de variables de entorno o configuración guardada (que podrían venir en
 * cualquier caja).
 *
 * - `'mainnet'`, `'MAINNET'`, `'public'` → `'MAINNET'`
 * - Cualquier otra cosa → `'TESTNET'`
 */
export function normalizeNetwork(input: string | null | undefined): StellarNetwork {
    if (!input) return 'TESTNET';
    const up = input.toString().toUpperCase();
    if (up === 'MAINNET' || up === 'PUBLIC') return 'MAINNET';
    return 'TESTNET';
}

/**
 * Construye una URI SEP-0007 `web+stellar:pay` que cualquier wallet Stellar
 * (Binance, Meru, Lobstr, Freighter, …) entiende y autocompleta.
 *
 * El comercio renderiza el resultado como QR. El cliente lo escanea, su wallet
 * se abre con destino, monto y asset ya rellenos.
 *
 * @example
 * ```ts
 * import { PollarPayClient, buildSep7PayUri } from '@pollar/pay';
 *
 * const intent = await pay.createIntent(25, 'Order #1234');
 * const uri = buildSep7PayUri(intent.data);
 * // → "web+stellar:pay?destination=GAB...&amount=25&asset_code=USDC&asset_issuer=GA5Z..."
 * ```
 */
export function buildSep7PayUri(
    input:
        | PayIntentData
        | {
              destination: string;
              amount: string | number;
              network: StellarNetwork;
              memo?: string;
              memo_type?: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH';
          },
): string {
    const destination = 'wallet_address' in input ? input.wallet_address : input.destination;
    const amount = 'amount' in input ? input.amount : (input as { amount: string | number }).amount;
    const network = input.network as StellarNetwork;
    const issuer = USDC_ISSUERS[network] ?? USDC_ISSUERS.TESTNET;

    const params = new URLSearchParams({
        destination,
        amount: typeof amount === 'number' ? amount.toString() : amount,
        asset_code: 'USDC',
        asset_issuer: issuer,
    });

    // Mainnet no necesita el passphrase explícito (las wallets asumen public).
    // Lo agregamos solo en testnet para evitar que firme contra la red equivocada.
    if (network === 'TESTNET') {
        params.set('network_passphrase', NETWORK_PASSPHRASES.TESTNET);
    }

    // Memo opcional — útil para conciliación on-chain del cliente.
    if ('memo' in input && input.memo) {
        params.set('memo', input.memo);
        if (input.memo_type) params.set('memo_type', input.memo_type);
    }

    return `web+stellar:pay?${params.toString()}`;
}

/**
 * Link a Stellar Expert para una transacción individual (hash).
 *
 * @example
 * ```ts
 * const url = buildStellarExpertTxUrl(status.forward_tx_hash!, status.network);
 * // → "https://stellar.expert/explorer/public/tx/abc123..."
 * ```
 */
export function buildStellarExpertTxUrl(txHash: string, network: StellarNetwork): string {
    const segment = network === 'MAINNET' ? 'public' : 'testnet';
    return `https://stellar.expert/explorer/${segment}/tx/${txHash}`;
}

/**
 * Link a Stellar Expert para una cuenta (account / wallet pubkey).
 *
 * @example
 * ```ts
 * const url = buildStellarExpertAccountUrl(intent.wallet_address, intent.network);
 * ```
 */
export function buildStellarExpertAccountUrl(pubkey: string, network: StellarNetwork): string {
    const segment = network === 'MAINNET' ? 'public' : 'testnet';
    return `https://stellar.expert/explorer/${segment}/account/${pubkey}`;
}

/**
 * Deriva la red Stellar a partir de una API key. Útil cuando todavía no
 * tenés un intent o status en mano.
 *
 * - `pub_mainnet_…` → `MAINNET`
 * - cualquier otra cosa → `TESTNET`
 */
export function networkFromApiKey(apiKey: string): StellarNetwork {
    return apiKey.startsWith('pub_mainnet_') ? 'MAINNET' : 'TESTNET';
}
