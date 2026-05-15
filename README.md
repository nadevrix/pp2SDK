# @pollar/pay

SDK oficial de **Pollar Pay** — acepta pagos en USDC sobre Stellar.

Tus clientes pagan desde **Binance, Meru, Lobstr** o cualquier wallet Stellar.
La liquidación tarda **3 – 5 segundos**, 24/7, sin bancos ni intermediarios.
Los fondos van directo a la wallet del comercio — Pollar no custodia nada.

```bash
npm install @pollar/pay
```

---

## Tabla de contenido

- [Quick start](#quick-start)
- [Cómo funciona](#cómo-funciona)
- [Generar el QR (SEP-7)](#generar-el-qr-sep-7)
- [Escenarios de pago](#escenarios-de-pago)
- [API](#api)
- [Helpers](#helpers)
- [Manejo de errores](#manejo-de-errores)
- [Estados del cobro](#estados-del-cobro)
- [Trazabilidad on-chain](#trazabilidad-on-chain)
- [TypeScript](#typescript)
- [Ejemplos](#ejemplos)

---

## Quick start

```typescript
import { PollarPayClient, buildSep7PayUri } from '@pollar/pay';

const pay = new PollarPayClient({
  apiKey: 'pub_testnet_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
});

// 1. Crear cobro de 25 USDC
const intent = await pay.createIntent(25, 'Pedido #1234');

// 2. Mostrar el QR — cualquier wallet Stellar entiende la URI SEP-7
const qrUri = buildSep7PayUri(intent.data);
//    → "web+stellar:pay?destination=GAB...&amount=25&asset_code=USDC&asset_issuer=GA5Z..."

// 3. Esperar a que el cliente pague (3 – 5 s sobre Stellar)
const stop = pay.waitForPayment(intent.data.transaction_id, {
  onCompleted: (s) => console.log('Pagado:', s.amount_paid, 'USDC'),
  onOverpaid:  (s) => console.log('Excedente — soporte va a contactarte'),
  onFailed:    (s) => console.log('No completado:', s.status),
});

// stop() cancela el polling manualmente si lo necesitás
```

La `apiKey` es la que sacás de **Dashboard → Avanzado** para cada sucursal.
Empieza con `pub_testnet_` o `pub_mainnet_` y el SDK detecta solo la red.

---

## Cómo funciona

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   tu app/POS    │ ──────► │  @pollar/pay     │ ──────► │  Pollar Pay API  │
│  (Node/browser) │ ◄────── │  (este SDK)      │ ◄────── │  (backend HTTPS) │
└─────────────────┘         └──────────────────┘         └──────────────────┘
                                                                  │
                                                                  ▼
                                                         ┌──────────────────┐
                                                         │ Stellar Horizon  │
                                                         │ (mainnet/testnet)│
                                                         └──────────────────┘
                                                                  │
                                                                  ▼
                                                         payout_wallet del
                                                          comercio (vos)
```

1. **`createIntent(amount, reason)`** lockea una wallet del pool por 15 minutos y devuelve su pubkey.
2. Tu app renderiza esa pubkey como **QR SEP-7** (ver abajo).
3. El cliente paga en USDC desde su wallet preferida.
4. **`waitForPayment()`** polea el backend; cada poll dispara un re-check on-chain.
5. Al completarse, los fondos se **reenvían automáticamente** a la wallet del comercio.

> Pollar **nunca custodia los fondos**. La wallet del comercio es una cuenta real en Stellar.

---

## Generar el QR (SEP-7)

El SDK te da `buildSep7PayUri()` — no hace falta que armes la URI a mano:

```typescript
import { buildSep7PayUri } from '@pollar/pay';

const uri = buildSep7PayUri(intent.data);
```

Lo que devuelve es la URI `web+stellar:pay?…` con destino, monto, asset code,
issuer USDC oficial y (en testnet) el `network_passphrase`. Cualquier wallet
Stellar — Binance, Meru, Lobstr, Freighter — la entiende y autocompleta los
campos.

Para renderizar el QR podés usar cualquier librería:

```typescript
// React
import { QRCodeSVG } from 'qrcode.react';
<QRCodeSVG value={uri} size={256} />

// Vanilla / browser
import qrcode from 'qrcode-generator';
const qr = qrcode(0, 'M');
qr.addData(uri);
qr.make();
document.getElementById('qr').innerHTML = qr.createSvgTag({ cellSize: 4 });

// Node
import QRCode from 'qrcode';
await QRCode.toFile('qr.png', uri);
```

---

## Escenarios de pago

El SDK y el backend manejan los 4 casos automáticamente — vos solo te enterás
del estado final vía callbacks.

| Escenario | Qué hace el sistema | Callback que recibís |
|---|---|---|
| **Pago exacto** | Cierra como `completed`. Reenvía fondos al comercio. | `onCompleted` |
| **Pago parcial** | El intent queda abierto mostrando `remaining`. Cualquier pagador puede completarlo. | (`onUpdate` con `amount_paid` parcial; final `onCompleted` o `onFailed` si expira) |
| **Múltiples pagadores** | Cada contribución se acumula. Wallet sigue asignada hasta cerrar el monto. | `onUpdate` por cada pago, `onCompleted` cuando se completa |
| **Overpago** | El comercio recibe el 100 % solicitado. El excedente queda registrado y trazado en el sistema. | `onOverpaid` |
| **Sin pago** | Tras 15 min expira como `expired`. La wallet se libera. | `onFailed` |

---

## API

### `new PollarPayClient(config)`

| Param | Tipo | Requerido | Descripción |
|---|---|---|---|
| `config.apiKey` | `string` | ✅ | API key publishable (`pub_testnet_…` o `pub_mainnet_…`) |
| `config.baseUrl` | `string` | — | Override de la URL del backend. Por defecto se autoresuelve |

Propiedades del cliente:

- `pay.apiKey` — la apiKey que pasaste.
- `pay.network` — `'TESTNET'` o `'MAINNET'`, derivado del prefijo de la apiKey.

### `pay.createIntent(amount, reason)`

Crea un cobro. Devuelve `wallet_address`, `transaction_id`, `amount`, `expires_at`, `network`.

| Param | Tipo | Descripción |
|---|---|---|
| `amount` | `number \| string` | Monto USDC (0.01 – 1,000,000) |
| `reason` | `string` | Motivo del cobro (lo ve el comercio en el dashboard) |

### `pay.checkStatus(transactionId)`

Devuelve el estado actual: `status`, `amount_paid`, `remaining`, `time_remaining_seconds`,
`fee_amount`, `payout_amount`, `is_free_tx`, `forward_status`, `forward_tx_hash`, etc.

Cada llamada con `status='pending'` dispara una re-verificación on-chain en el
backend, así que el polling siempre tiene datos frescos.

### `pay.waitForPayment(transactionId, callbacks, options?)`

Polea cada 5 s (configurable). Se detiene automático cuando el cobro llega a
un estado final. Devuelve `stop()` para cancelar manualmente.

| Callback | Cuándo se dispara |
|---|---|
| `onUpdate` | En cada poll, con el último estado |
| `onCompleted` | Pago exacto recibido, fondos reenviados al comercio |
| `onOverpaid` | El cliente pagó más de lo esperado |
| `onFailed` | Expiró, parcial-y-venció, o anomalía |
| `onError` | Un poll falló (sigue con backoff exponencial) |
| `onTimeout` | Llegó al `maxWaitMs` o demasiados errores consecutivos |

Opciones:

| Opción | Default | Descripción |
|---|---|---|
| `intervalMs` | `5000` | Intervalo entre polls |
| `maxWaitMs` | `960000` (16 min) | Tiempo máximo total de polling |
| `maxConsecutiveErrors` | `5` | Errores seguidos antes de rendirse |

### `pay.manualComplete(transactionId)`

Cierra un intent off-chain. Útil cuando el cliente pagó en efectivo y querés
que el cobro figure como completado. Si llegaron fondos parciales on-chain
antes del cierre, el backend los reenvía al comercio primero.

---

## Helpers

Funciones puras, cero deps, exportadas desde el paquete:

```typescript
import {
  buildSep7PayUri,                // arma la URI del QR
  buildStellarExpertTxUrl,        // link al hash en Stellar Expert
  buildStellarExpertAccountUrl,   // link a la cuenta en Stellar Expert
  networkFromApiKey,              // 'pub_mainnet_…' → 'MAINNET'
  normalizeNetwork,               // string arbitrario → 'TESTNET' | 'MAINNET'
  USDC_ISSUERS,                   // { MAINNET, TESTNET } — issuers oficiales
  NETWORK_PASSPHRASES,            // passphrases oficiales por red
} from '@pollar/pay';
```

Ejemplo armando el link al comprobante:

```typescript
const status = await pay.checkStatus(transactionId);
if (status.data.forward_tx_hash) {
  const url = buildStellarExpertTxUrl(
    status.data.forward_tx_hash,
    pay.network,
  );
  console.log('Comprobante:', url);
  // → https://stellar.expert/explorer/testnet/tx/abc123...
}
```

---

## Manejo de errores

Todos los métodos arrojan `PollarPayError` con un `code` tipado:

```typescript
import { PollarPayClient, PollarPayError, PAY_ERROR_CODES } from '@pollar/pay';

try {
  await pay.createIntent(25, 'Pedido #1234');
} catch (err) {
  if (err instanceof PollarPayError) {
    switch (err.code) {
      case PAY_ERROR_CODES.NO_WALLETS_AVAILABLE:
        // Pool ocupado — reintentar en ~1 min
        break;
      case PAY_ERROR_CODES.INVALID_API_KEY:
        // Credencial inválida o sin Pollar Pay habilitado
        break;
      case PAY_ERROR_CODES.INVALID_AMOUNT:
        // Fuera del rango 0.01 – 1,000,000
        break;
      case PAY_ERROR_CODES.NETWORK_ERROR:
        // Backend o red caídos
        break;
    }
  }
}
```

---

## Estados del cobro

| Status | Significado |
|---|---|
| `pending` | Esperando USDC del cliente |
| `completed` | Monto exacto (o más) recibido, fondos reenviados |
| `overpaid` | El cliente pagó más de lo esperado |
| `underpaid` | Timer venció con pago parcial |
| `expired` | Timer venció sin ningún pago |
| `refunded` | Admin emitió reembolso desde treasury |
| `anomaly` | Forward falló — requiere revisión manual |

---

## Trazabilidad on-chain

Cada cobro deja un rastro verificable en Stellar:

```typescript
import { buildStellarExpertTxUrl } from '@pollar/pay';

const status = await pay.checkStatus(transactionId);
if (status.data.forward_tx_hash) {
  const url = buildStellarExpertTxUrl(status.data.forward_tx_hash, pay.network);
  // Mostrale al cliente: "Ver comprobante en Stellar Expert"
}
```

Ningún servicio centralizado puede ofrecer esto — los hashes son públicos y
permanentes.

---

## TypeScript

El SDK está escrito en TypeScript y publica tipos completos. Los tipos
importantes:

```typescript
import type {
  PollarPayConfig,
  PayIntentData,
  PayStatusData,
  PaymentStatus,
  PaymentCallbacks,
  WaitForPaymentOptions,
  StellarNetwork,
  PayErrorCode,
} from '@pollar/pay';
```

Funciona en Node 18+, Deno, Bun, browsers modernos y edge runtimes (Vercel
Edge, Cloudflare Workers, etc.).

---

## Ejemplos

### Express / Node — checkout estilo Stripe

```typescript
import express from 'express';
import { PollarPayClient, buildSep7PayUri } from '@pollar/pay';

const pay = new PollarPayClient({ apiKey: process.env.POLLAR_API_KEY! });
const app = express();
app.use(express.json());

app.post('/api/checkout', async (req, res) => {
  const intent = await pay.createIntent(req.body.amount, req.body.reason);
  res.json({
    transaction_id: intent.data.transaction_id,
    sep7_uri: buildSep7PayUri(intent.data),
    expires_at: intent.data.expires_at,
  });
});

app.get('/api/checkout/:id', async (req, res) => {
  const status = await pay.checkStatus(req.params.id);
  res.json(status.data);
});
```

> **Importante**: la `apiKey` vive solo en el server. El browser nunca la ve.

### React — esperar pago con callbacks

```typescript
import { useEffect, useState } from 'react';
import { PollarPayClient, buildSep7PayUri, type PayStatusData } from '@pollar/pay';

const pay = new PollarPayClient({ apiKey: 'pub_testnet_…' });

function Checkout({ amount, reason }) {
  const [intent, setIntent] = useState(null);
  const [status, setStatus] = useState<PayStatusData | null>(null);

  useEffect(() => {
    pay.createIntent(amount, reason).then(r => setIntent(r.data));
  }, [amount, reason]);

  useEffect(() => {
    if (!intent) return;
    const stop = pay.waitForPayment(intent.transaction_id, {
      onUpdate:    s => setStatus(s),
      onCompleted: s => setStatus(s),
      onOverpaid:  s => setStatus(s),
      onFailed:    s => setStatus(s),
    });
    return stop;
  }, [intent]);

  if (!intent) return <p>Generando cobro…</p>;
  const uri = buildSep7PayUri(intent);

  return (
    <div>
      <QR value={uri} />
      <p>{status?.status ?? 'pending'}</p>
    </div>
  );
}
```

### Vanilla JS — POS de mostrador

```typescript
import { PollarPayClient, buildSep7PayUri } from '@pollar/pay';

const pay = new PollarPayClient({ apiKey: prompt('apiKey?') });

async function cobrar(monto) {
  const intent = await pay.createIntent(monto, 'Mostrador');
  document.querySelector('#qr').src =
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(buildSep7PayUri(intent.data))}`;

  pay.waitForPayment(intent.data.transaction_id, {
    onCompleted: () => alert('¡Cobrado!'),
    onFailed:    s => alert('No completado: ' + s.status),
  });
}
```

---

## License

MIT
