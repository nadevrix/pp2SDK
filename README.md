# @pollar/pay

Accept USDC payments on Stellar — the official SDK for Pollar Pay.

`@pollar/pay` lets your app generate USDC payment intents and watch them settle on-chain. Customers can pay from **Binance, Meru, Lobstr or any Stellar-compatible wallet**. Settlement happens in **3 – 5 seconds**, 24/7, with no bank or intermediary involved.

Authenticate with the publishable API key issued by your Pollar Pay branch — no extra credentials.

## Install

```bash
npm install @pollar/pay
```

## Quick start

```typescript
import { PollarPayClient } from '@pollar/pay';

const pay = new PollarPayClient({
  apiKey: 'pub_testnet_703470595eb6cb72c18651b1455fdc34',
});

// 1. Create a payment intent for 25 USDC
const intent = await pay.createIntent(25.00, 'Order #1234');

console.log(intent.data.wallet_address);  // → Stellar address — render as QR
console.log(intent.data.transaction_id);  // → use for status polling
console.log(intent.data.expires_at);      // → 15-minute expiration

// 2. Poll until paid (3–5 s settlement on Stellar)
const stop = pay.waitForPayment(intent.data.transaction_id, {
  onUpdate: (s) => console.log(`status=${s.status} paid=${s.amount_paid}`),
  onCompleted: (s) => console.log('Paid:', s.amount_paid, 'USDC'),
  onOverpaid: (s) => console.log('Overpaid — contact support'),
  onFailed: (s) => console.log('Not completed:', s.status),
});

// Call stop() to cancel polling manually
```

## QR code (SEP-0007)

The customer's wallet expects a SEP-0007 `web+stellar:pay` URI. Build it from the intent:

```typescript
const USDC_ISSUERS = {
  MAINNET: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  TESTNET: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

function buildPaymentUri(intent) {
  const issuer = USDC_ISSUERS[intent.data.network];
  return `web+stellar:pay?destination=${intent.data.wallet_address}` +
         `&amount=${intent.data.amount}` +
         `&asset_code=USDC&asset_issuer=${issuer}`;
}
```

Any Stellar wallet — Binance, Meru, Lobstr, Freighter — recognises this URI and pre-fills the payment with the correct amount.

## How it works

1. **`createIntent(amount, reason)`** locks a Stellar wallet from the pool for 15 minutes and returns its public key.
2. Your app shows that public key as a **QR code** (see above).
3. The customer pays in USDC from any Stellar wallet.
4. **`waitForPayment()`** polls the backend; each poll asks Stellar Horizon for new payments on that wallet.
5. On completion the funds are **automatically forwarded** to your branch's payout wallet.

Pollar never custodies the funds — the payout wallet is yours.

## Payment scenarios

The SDK and backend handle the four real-world cases automatically:

| Scenario | Behaviour |
|---|---|
| **Exact payment** | Intent closes as `completed`. Funds forwarded. |
| **Partial payment** | Intent stays open showing `remaining` until completed or expired. Multiple senders can contribute. |
| **Overpayment** | Intent closes as `overpaid`. The merchant receives the full amount; excess is registered for support to settle. |
| **No payment** | Intent expires as `expired` after 15 minutes. |

## API

### `new PollarPayClient(config)`

| Param | Type | Required | Description |
|---|---|---|---|
| `config.apiKey` | `string` | ✅ | Pollar publishable key (`pub_testnet_xxx` or `pub_mainnet_xxx`) |
| `config.baseUrl` | `string` | — | Override backend URL. Auto-resolved from key prefix. |

### `pay.createIntent(amount, reason)`

Creates a payment intent. Returns `wallet_address`, `transaction_id`, `amount`, `expires_at`, and `network`.

| Param | Type | Description |
|---|---|---|
| `amount` | `number \| string` | USDC amount (0.01 – 1,000,000) |
| `reason` | `string` | Description shown on the merchant dashboard (e.g. "Order #1234") |

### `pay.checkStatus(transactionId)`

Returns the current payment state — `amount_paid`, `remaining`, `time_remaining_seconds`, `forward_tx_hash`, etc. Triggers an on-chain re-check when the intent is still `pending`.

### `pay.waitForPayment(transactionId, callbacks, options?)`

Polls every 5 s (configurable). Stops automatically on terminal status. Returns a `stop()` function to cancel manually.

| Callback | When it fires |
|---|---|
| `onUpdate` | Every poll |
| `onCompleted` | Exact amount received, funds forwarded |
| `onOverpaid` | Customer paid more than expected |
| `onFailed` | Expired, underpaid, or anomaly |
| `onError` | Network error during polling (retried with backoff) |
| `onTimeout` | `maxWaitMs` reached or too many consecutive errors |

### `pay.manualComplete(transactionId)`

Closes an intent off-chain (useful when the customer paid in cash and you want to mark the cobro as settled).

## Error handling

All methods throw `PollarPayError` with a typed `code`:

```typescript
import { PollarPayClient, PollarPayError, PAY_ERROR_CODES } from '@pollar/pay';

try {
  await pay.createIntent(25, 'Order #1234');
} catch (err) {
  if (err instanceof PollarPayError) {
    switch (err.code) {
      case PAY_ERROR_CODES.NO_WALLETS_AVAILABLE:
        // Pool busy — retry in ~1 minute
        break;
      case PAY_ERROR_CODES.INVALID_API_KEY:
        // Bad credential
        break;
      case PAY_ERROR_CODES.INVALID_AMOUNT:
        // Out of allowed range
        break;
    }
  }
}
```

## Payment statuses

| Status | Description |
|---|---|
| `pending` | Waiting for USDC from customer |
| `completed` | Exact (or above) amount received, funds forwarded |
| `overpaid` | Customer paid more than expected |
| `underpaid` | Timer expired with partial payment |
| `expired` | Timer expired with no payment |
| `refunded` | Admin issued a refund |
| `anomaly` | Forward failed — needs manual review |

## Trustless by design

Every payment leaves an on-chain trail. Inspect any transaction on [Stellar Expert](https://stellar.expert):

```typescript
const result = await pay.checkStatus(transactionId);
const hash = result.data.forward_tx_hash;
const url = `https://stellar.expert/explorer/public/tx/${hash}`;
```

## License

MIT
