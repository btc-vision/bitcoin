# Networks

The `networks` module defines configuration constants for every supported blockchain network. Each constant implements the `Network` interface and encodes the version bytes, prefixes, and BIP32 derivation parameters that the rest of the library -- address encoding, payments, PSBT construction -- relies on to produce chain-specific output.

## Overview

| Network | Export name | Mainnet / Testnet | Bech32 / SegWit support |
|---------|-------------|-------------------|------------------------|
| Bitcoin | `bitcoin` | Mainnet | Yes |
| Bitcoin Testnet | `testnet` | Testnet | Yes |
| OPNet Testnet | `opnetTestnet` | Testnet | Yes |
| Bitcoin Regtest | `regtest` | Testnet (local) | Yes |
| Dogecoin | `dogecoin` | Mainnet | No |
| Dogecoin Testnet | `dogecoinTestnet` | Testnet | No |
| Litecoin | `litecoin` | Mainnet | Yes |
| Litecoin Testnet | `litecoinTestnet` | Testnet | Yes |
| Bitcoin Cash | `bitcoinCash` | Mainnet | Cashaddr only |
| Bitcoin Cash Testnet | `bitcoinCashTestnet` | Testnet | Cashaddr only |
| Dash | `dash` | Mainnet | No |
| Dash Testnet | `dashTestnet` | Testnet | No |

---

## Installation

```typescript
import { networks } from '@btc-vision/bitcoin';

// Individual imports
import {
    bitcoin,
    testnet,
    opnetTestnet,
    regtest,
    dogecoin,
    dogecoinTestnet,
    litecoin,
    litecoinTestnet,
    bitcoinCash,
    bitcoinCashTestnet,
    dash,
    dashTestnet,
} from '@btc-vision/bitcoin/src/networks.js';

// Type import
import type { Network } from '@btc-vision/bitcoin';
// Note: The Bip32 interface is NOT re-exported from '@btc-vision/bitcoin'.
// It is defined in src/networks.ts. Access it via the Network.bip32 property type:
// type Bip32 = Network['bip32'];
```

> **Note:** The `Bip32` interface is not exported from the main `@btc-vision/bitcoin` entry point. If you need to reference the type directly, derive it from the `Network` interface:
>
> ```typescript
> type Bip32 = Network['bip32'];
> ```

---

## Interface: Network

Every network constant satisfies the `Network` interface. Each field controls how keys and addresses are serialized on that chain.

```typescript
interface Network {
    readonly wif: number;
    readonly bip32: Bip32;
    readonly messagePrefix: string;
    readonly bech32: string;
    readonly bech32Opnet?: string;
    readonly pubKeyHash: number;
    readonly scriptHash: number;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `messagePrefix` | `string` | Prefix prepended to messages before signing (e.g. `"\x18Bitcoin Signed Message:\n"`). Used by message-signing utilities to domain-separate signatures across chains. |
| `bech32` | `string` | Human-readable part (HRP) for Bech32 / Bech32m addresses. For Bitcoin mainnet this is `"bc"`, producing addresses like `bc1q...`. Empty string for chains that do not support SegWit (Dogecoin, Dash). |
| `bech32Opnet` | `string` (optional) | Human-readable part for OP_NET addresses. For Bitcoin mainnet this is `"op"`. Empty string for chains without OP_NET support. |
| `bip32` | `Bip32` | Version bytes for BIP32 extended key serialization. Controls whether `xpub` / `xprv` or an alternative prefix is produced. |
| `pubKeyHash` | `number` | Version byte for Pay-to-Public-Key-Hash (P2PKH) addresses (base58check). Determines the leading character of legacy addresses (`1` for Bitcoin, `D` for Dogecoin, `L` for Litecoin, etc.). |
| `scriptHash` | `number` | Version byte for Pay-to-Script-Hash (P2SH) addresses (base58check). Determines the leading character of script addresses (`3` for Bitcoin). |
| `wif` | `number` | Version byte for Wallet Import Format (WIF) private key encoding. |

---

## Interface: Bip32

```typescript
interface Bip32 {
    readonly public: number;
    readonly private: number;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `public` | `number` | 4-byte version prefix for BIP32 extended **public** keys. For Bitcoin mainnet (`0x0488b21e`) this produces keys starting with `xpub`. |
| `private` | `number` | 4-byte version prefix for BIP32 extended **private** keys. For Bitcoin mainnet (`0x0488ade4`) this produces keys starting with `xprv`. |

---

## Network Constants

### bitcoin (Mainnet)

```typescript
export const bitcoin: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bc',
    bech32Opnet: 'op',
    bip32: {
        public: 0x0488b21e,
        private: 0x0488ade4,
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
};
```

- P2PKH addresses start with `1`
- P2SH addresses start with `3`
- Bech32 addresses start with `bc1q` (SegWit v0) or `bc1p` (SegWit v1 / Taproot)
- Extended public keys start with `xpub`, private keys with `xprv`

---

### testnet (Bitcoin Testnet)

```typescript
export const testnet: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'tb',
    bech32Opnet: 'opt',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};
```

- P2PKH addresses start with `m` or `n`
- P2SH addresses start with `2`
- Bech32 addresses start with `tb1q` or `tb1p`
- Extended public keys start with `tpub`, private keys with `tprv`

---

### opnetTestnet (OPNet Testnet)

```typescript
export const opnetTestnet: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'opt',
    bech32Opnet: 'opt',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};
```

- Shares `pubKeyHash`, `scriptHash`, `wif`, and `bip32` values with testnet
- Uses `'opt'` as both the `bech32` and `bech32Opnet` prefix, producing addresses like `opt1q...`

---

### regtest (Bitcoin Regtest)

```typescript
export const regtest: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bcrt',
    bech32Opnet: 'opr',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};
```

- Shares `pubKeyHash`, `scriptHash`, `wif`, and `bip32` values with testnet
- Distinguished by the `bech32` HRP `"bcrt"`, producing addresses like `bcrt1q...`

---

### dogecoin (Mainnet)

```typescript
export const dogecoin: Network = {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: '',
    bech32Opnet: '',
    bip32: {
        public: 0x02facafd,
        private: 0x02fac398,
    },
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e,
};
```

- P2PKH addresses start with `D`
- P2SH addresses start with `9` or `A`
- No Bech32 / SegWit support (empty `bech32` string)

---

### dogecoinTestnet

```typescript
export const dogecoinTestnet: Network = {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: '',
    bech32Opnet: '',
    bip32: {
        public: 0x0432a9a8,
        private: 0x0432a243,
    },
    pubKeyHash: 0x71,
    scriptHash: 0xc4,
    wif: 0xf1,
};
```

- No Bech32 / SegWit support

---

### litecoin (Mainnet)

```typescript
export const litecoin: Network = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bech32Opnet: 'opl',
    bip32: {
        public: 0x019da462,
        private: 0x019d9cfe,
    },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
};
```

- P2PKH addresses start with `L`
- P2SH addresses start with `M`
- Bech32 addresses start with `ltc1q`

---

### litecoinTestnet

```typescript
export const litecoinTestnet: Network = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'tltc',
    bech32Opnet: 'oplt',
    bip32: {
        public: 0x0436ef7d,
        private: 0x0436f6e1,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0x3a,
    wif: 0xef,
};
```

- Bech32 addresses start with `tltc1q`

---

### bitcoinCash (Mainnet)

```typescript
export const bitcoinCash: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bitcoincash',
    bech32Opnet: 'opbch',
    bip32: {
        public: 0x0488b21e,
        private: 0x0488ade4,
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
};
```

- Shares `pubKeyHash`, `scriptHash`, `wif`, and `bip32` values with Bitcoin mainnet (common fork heritage)
- The `bech32` field is set to `"bitcoincash"` for Cashaddr-style addresses, not SegWit
- Bitcoin Cash does not support SegWit; the Cashaddr prefix is provided for compatibility

---

### bitcoinCashTestnet

```typescript
export const bitcoinCashTestnet: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bchtest',
    bech32Opnet: 'opbcht',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};
```

---

### dash (Mainnet)

```typescript
export const dash: Network = {
    messagePrefix: '\x19DarkCoin Signed Message:\n',
    bech32: '',
    bech32Opnet: '',
    bip32: {
        public: 0x02fe52cc,
        private: 0x02fe52f8,
    },
    pubKeyHash: 0x4c,
    scriptHash: 0x10,
    wif: 0xcc,
};
```

- P2PKH addresses start with `X`
- Uses the legacy DarkCoin message prefix
- No Bech32 / SegWit support

---

### dashTestnet

```typescript
export const dashTestnet: Network = {
    messagePrefix: '\x19DarkCoin Signed Message:\n',
    bech32: '',
    bech32Opnet: '',
    bip32: {
        public: 0x3a8061a0,
        private: 0x3a805837,
    },
    pubKeyHash: 0x8c,
    scriptHash: 0x13,
    wif: 0xef,
};
```

- No Bech32 / SegWit support

---

## Network Comparison Table

### Address Version Bytes

| Network | `pubKeyHash` | `scriptHash` | `wif` |
|---------|-------------|-------------|-------|
| bitcoin | `0x00` | `0x05` | `0x80` |
| testnet | `0x6f` | `0xc4` | `0xef` |
| opnetTestnet | `0x6f` | `0xc4` | `0xef` |
| regtest | `0x6f` | `0xc4` | `0xef` |
| dogecoin | `0x1e` | `0x16` | `0x9e` |
| dogecoinTestnet | `0x71` | `0xc4` | `0xf1` |
| litecoin | `0x30` | `0x32` | `0xb0` |
| litecoinTestnet | `0x6f` | `0x3a` | `0xef` |
| bitcoinCash | `0x00` | `0x05` | `0x80` |
| bitcoinCashTestnet | `0x6f` | `0xc4` | `0xef` |
| dash | `0x4c` | `0x10` | `0xcc` |
| dashTestnet | `0x8c` | `0x13` | `0xef` |

### Bech32 and OP_NET Prefixes

| Network | `bech32` | `bech32Opnet` | SegWit supported |
|---------|----------|---------------|-----------------|
| bitcoin | `bc` | `op` | Yes |
| testnet | `tb` | `opt` | Yes |
| opnetTestnet | `opt` | `opt` | Yes |
| regtest | `bcrt` | `opr` | Yes |
| dogecoin | _(empty)_ | _(empty)_ | No |
| dogecoinTestnet | _(empty)_ | _(empty)_ | No |
| litecoin | `ltc` | `opl` | Yes |
| litecoinTestnet | `tltc` | `oplt` | Yes |
| bitcoinCash | `bitcoincash` | `opbch` | No (Cashaddr) |
| bitcoinCashTestnet | `bchtest` | `opbcht` | No (Cashaddr) |
| dash | _(empty)_ | _(empty)_ | No |
| dashTestnet | _(empty)_ | _(empty)_ | No |

### BIP32 Extended Key Versions

| Network | `bip32.public` | `bip32.private` |
|---------|---------------|----------------|
| bitcoin | `0x0488b21e` | `0x0488ade4` |
| testnet | `0x043587cf` | `0x04358394` |
| opnetTestnet | `0x043587cf` | `0x04358394` |
| regtest | `0x043587cf` | `0x04358394` |
| dogecoin | `0x02facafd` | `0x02fac398` |
| dogecoinTestnet | `0x0432a9a8` | `0x0432a243` |
| litecoin | `0x019da462` | `0x019d9cfe` |
| litecoinTestnet | `0x0436ef7d` | `0x0436f6e1` |
| bitcoinCash | `0x0488b21e` | `0x0488ade4` |
| bitcoinCashTestnet | `0x043587cf` | `0x04358394` |
| dash | `0x02fe52cc` | `0x02fe52f8` |
| dashTestnet | `0x3a8061a0` | `0x3a805837` |

---

## Using Networks with Other Modules

The `Network` object threads through the entire library. Pass it explicitly to override the default (Bitcoin mainnet).

### Address Encoding

`address.fromOutputScript` and `address.toOutputScript` accept a network parameter to produce chain-correct addresses.

```typescript
import { address, networks } from '@btc-vision/bitcoin';

// Decode an output script into a testnet address
const testnetAddress = address.fromOutputScript(outputScript, networks.testnet);
// e.g. "tb1q..."

// Encode a Litecoin address into its output script
const ltcScript = address.toOutputScript('ltc1q...', networks.litecoin);
```

### Payments (P2PKH, P2SH, P2WPKH, P2WSH, P2TR, P2MR, P2OP)

Every payment constructor accepts an optional `network` field. When omitted, `networks.bitcoin` is used as the default.

```typescript
import { payments, networks } from '@btc-vision/bitcoin';

// Create a P2WPKH payment on the testnet
const p2wpkh = payments.p2wpkh({
    pubkey: publicKey,
    network: networks.testnet,
});
console.log(p2wpkh.address); // "tb1q..."

// Create a P2PKH payment on Litecoin
const p2pkh = payments.p2pkh({
    pubkey: publicKey,
    network: networks.litecoin,
});
console.log(p2pkh.address); // "L..."

// Create a P2TR payment on regtest
const p2tr = payments.p2tr({
    internalPubkey: xOnlyPubKey,
    network: networks.regtest,
});
console.log(p2tr.address); // "bcrt1p..."
```

### PSBT (Partially Signed Bitcoin Transactions)

The `Psbt` constructor accepts an options object with a `network` field. This determines how addresses embedded in the PSBT are interpreted and encoded.

```typescript
import { Psbt, networks } from '@btc-vision/bitcoin';

// Create a PSBT targeting the testnet
const psbt = new Psbt({ network: networks.testnet });

psbt.addInput({
    hash: txid,
    index: 0,
    witnessUtxo: {
        script: outputScript,
        value: 50000n,
    },
});

psbt.addOutput({
    address: 'tb1q...',
    value: 40000n,
});
```

### Key Pairs (ECPair / BIP32)

When creating or importing key pairs, pass the network so that WIF encoding and BIP32 serialization use the correct version bytes.

```typescript
import { networks } from '@btc-vision/bitcoin';
import { ECPairFactory } from '@btc-vision/ecpair';

const ECPair = ECPairFactory(ecc);

// Import a WIF private key on testnet
const keyPair = ECPair.fromWIF(
    'cNaQCDwmmh4dS9LzCgVtyy1e1xjCJ21GUDHe9K98nzb689JvinGV',
    networks.testnet,
);

// Generate a random key pair for Litecoin
const ltcKey = ECPair.makeRandom({ network: networks.litecoin });
console.log(ltcKey.toWIF()); // WIF with Litecoin version byte 0xb0
```

---

## Code Examples

### Switching Between Networks

A common pattern is to parameterize your application with a `Network` object so the same code works across chains.

```typescript
import { payments, networks, type Network } from '@btc-vision/bitcoin';

function generateP2WPKHAddress(pubkey: Uint8Array, network: Network): string {
    const payment = payments.p2wpkh({ pubkey, network });
    if (!payment.address) throw new Error('Could not derive address');
    return payment.address;
}

// Bitcoin mainnet
const btcAddr = generateP2WPKHAddress(pubkey, networks.bitcoin);
// "bc1q..."

// Bitcoin testnet
const tbtcAddr = generateP2WPKHAddress(pubkey, networks.testnet);
// "tb1q..."

// Litecoin mainnet
const ltcAddr = generateP2WPKHAddress(pubkey, networks.litecoin);
// "ltc1q..."
```

### Detecting the Network from an Address

You can iterate over network constants to determine which network an address belongs to.

```typescript
import { address, networks, type Network } from '@btc-vision/bitcoin';

const allNetworks: { name: string; network: Network }[] = [
    { name: 'bitcoin', network: networks.bitcoin },
    { name: 'testnet', network: networks.testnet },
    { name: 'opnetTestnet', network: networks.opnetTestnet },
    { name: 'regtest', network: networks.regtest },
    { name: 'litecoin', network: networks.litecoin },
    { name: 'litecoinTestnet', network: networks.litecoinTestnet },
];

function detectNetwork(addr: string): string | undefined {
    for (const { name, network } of allNetworks) {
        try {
            address.toOutputScript(addr, network);
            return name;
        } catch {
            // Not this network, try the next
        }
    }
    return undefined;
}

console.log(detectNetwork('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'));
// "bitcoin"

console.log(detectNetwork('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'));
// "testnet"
```

### Building a Transaction for a Non-Default Network

```typescript
import { Psbt, payments, networks } from '@btc-vision/bitcoin';

const network = networks.testnet;

// Derive a P2WPKH payment for the sender
const senderPayment = payments.p2wpkh({
    pubkey: senderPubKey,
    network,
});

// Create the PSBT on the correct network
const psbt = new Psbt({ network });

psbt.addInput({
    hash: prevTxId,
    index: 0,
    witnessUtxo: {
        script: senderPayment.output!,
        value: 100000n,
    },
});

psbt.addOutput({
    address: recipientTestnetAddress, // "tb1q..." or "2..." or "m..."
    value: 90000n,
});

// Sign, finalize, and extract as usual
```

---

## Source Reference

All network constants are defined in a single file:

- [`src/networks.ts`](../src/networks.ts) -- based on the [Bitcoin wiki list of address prefixes](https://en.bitcoin.it/wiki/List_of_address_prefixes)
