# @pollar/pay

Accept USDC payments on Stellar — part of the [Pollar](https://pollar.xyz) SDK.

`@pollar/pay` lets you create payment intents, generate QR-ready wallet addresses, and poll for payment completion. Uses the same publishable API key you already have from Pollar — no extra credentials needed.

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
const intent = await pay.createIntent(25.00);

console.log(intent.data.wallet_address);  // → Stellar address for QR code
console.log(intent.data.transaction_id);  // → Use for status polling
console.log(intent.data.expires_at);      // → 15-minute expiration

// 2. Poll until paid
const stop = pay.waitForPayment(intent.data.transaction_id, {
  onUpdate: (s) => console.log(`Status: ${s.status}, paid: ${s.amount_paid} USDC`),
  onCompleted: (s) => console.log('✅ Payment completed!', s.amount_paid),
  onOverpaid: (s) => console.log('⚠️ Overpaid — contact support'),
  onFailed: (s) => console.log('❌ Payment failed:', s.status),
});

// Call stop() to cancel polling manually
```

## How it works

1. **`createIntent(amount)`** — Locks a wallet from the pool for 15 minutes. Returns a Stellar address and a `transaction_id`.
2. Your app shows the wallet address as a **QR code** to the customer.
3. The customer sends USDC from any Stellar wallet.
4. **`waitForPayment()`** polls the backend every 5 seconds. When payment is detected, the callback fires.
5. On completion, funds are automatically forwarded to the merchant's payout wallet.

## API

### `new PollarPayClient(config)`

| Param | Type | Required | Description |
|---|---|---|---|
| `config.apiKey` | `string` | ✅ | Your Pollar publishable key (`pub_testnet_xxx` or `pub_mainnet_xxx`) |
| `config.baseUrl` | `string` | — | Override backend URL. Auto-resolved from key prefix. |

### `pay.createIntent(amount)`

Creates a payment intent. Returns `wallet_address`, `transaction_id`, and `expires_at`.

| Param | Type | Description |
|---|---|---|
| `amount` | `number \| string` | USDC amount (0.01 – 1,000,000) |

### `pay.checkStatus(transactionId)`

Returns current payment status including `amount_paid`, `remaining`, and `time_remaining_seconds`.

### `pay.waitForPayment(transactionId, callbacks, intervalMs?)`

Polls for status updates. Returns a `stop()` function. Automatically stops on final status.

| Callback | When it fires |
|---|---|
| `onUpdate` | Every poll |
| `onCompleted` | Payment received (exact or above) |
| `onOverpaid` | Customer paid more than expected |
| `onFailed` | Expired, underpaid, or anomaly |
| `onError` | Network error during polling |

## Error handling

All methods throw `PollarPayError` with a typed `code`:

```typescript
import { PollarPayClient, PollarPayError, PAY_ERROR_CODES } from '@pollar/pay';

try {
  await pay.createIntent(25);
} catch (err) {
  if (err instanceof PollarPayError) {
    switch (err.code) {
      case PAY_ERROR_CODES.NO_WALLETS_AVAILABLE:
        console.log('System busy, retry in 1 minute');
        break;
      case PAY_ERROR_CODES.INVALID_API_KEY:
        console.log('Check your API key');
        break;
    }
  }
}
```

## Payment statuses

| Status | Description |
|---|---|
| `pending` | Waiting for USDC from customer |
| `completed` | Exact amount received, funds forwarded |
| `overpaid` | Received more than expected |
| `underpaid` | Timer expired with partial payment |
| `expired` | Timer expired with no payment |
| `refunded` | Admin issued a refund |
| `anomaly` | Forward failed — needs manual review |

## Related packages

- [`@pollar/core`](https://www.npmjs.com/package/@pollar/core) — Authentication and Stellar transactions
- [`@pollar/react`](https://www.npmjs.com/package/@pollar/react) — React UI components

## License

MIT
