# Address Module

The address module provides encoding and decoding tools for all Bitcoin address formats, including Base58Check (legacy), Bech32/Bech32m (SegWit), and conversion between addresses and output scripts. It supports P2PKH, P2SH, P2WPKH, P2WSH, P2TR, P2MR, P2OP, and future SegWit versions.

## Overview

| Feature | Description |
|---------|-------------|
| Base58Check | Encode/decode legacy P2PKH and P2SH addresses |
| Bech32 | Encode/decode SegWit v0 addresses (P2WPKH, P2WSH) |
| Bech32m | Encode/decode SegWit v1+ addresses (P2TR, P2MR, P2OP, future) |
| Output scripts | Convert between addresses and their locking scripts |
| Networks | Bitcoin mainnet, testnet, opnetTestnet, regtest, Litecoin, Dogecoin, Dash, and more |

---

## Supported Address Types

| Type | SegWit Version | Encoding | Mainnet Prefix | Testnet Prefix | Regtest Prefix | Script Pattern |
|------|---------------|----------|----------------|----------------|----------------|----------------|
| P2PKH | N/A | Base58Check | `1...` | `m...` / `n...` | `m...` / `n...` | `OP_DUP OP_HASH160 <20B> OP_EQUALVERIFY OP_CHECKSIG` |
| P2SH | N/A | Base58Check | `3...` | `2...` | `2...` | `OP_HASH160 <20B> OP_EQUAL` |
| P2WPKH | 0 | Bech32 | `bc1q...` | `tb1q...` | `bcrt1q...` | `OP_0 <20B>` |
| P2WSH | 0 | Bech32 | `bc1q...` | `tb1q...` | `bcrt1q...` | `OP_0 <32B>` |
| P2TR | 1 | Bech32m | `bc1p...` | `tb1p...` | `bcrt1p...` | `OP_1 <32B>` |
| P2MR | 2 | Bech32m | `bc1z...` | `tb1z...` | `bcrt1z...` | `OP_2 <32B>` |
| P2OP | 16 | Bech32m | `op1...` | `opt1...` | `opr1...` | `OP_16 <program>` |
| Future SegWit | 2-15 | Bech32m | `bc1...` | `tb1...` | `bcrt1...` | `OP_n <2-40B>` |

---

## Network-Specific Prefixes

| Network | `bech32` | `bech32Opnet` | `pubKeyHash` | `scriptHash` |
|---------|----------|---------------|--------------|--------------|
| Bitcoin mainnet | `bc` | `op` | `0x00` | `0x05` |
| Bitcoin testnet | `tb` | `opt` | `0x6f` | `0xc4` |
| OPNet testnet | `opt` | `opt` | `0x6f` | `0xc4` |
| Bitcoin regtest | `bcrt` | `opr` | `0x6f` | `0xc4` |
| Litecoin mainnet | `ltc` | `opl` | `0x30` | `0x32` |
| Litecoin testnet | `tltc` | `oplt` | `0x6f` | `0x3a` |

---

## Installation

```typescript
import {
    address,
    networks,
} from '@btc-vision/bitcoin';

// Or import specific functions directly (re-exported from address module)
import {
    fromBase58Check,
    toBase58Check,
    fromBech32,
    toBech32,
    fromOutputScript,
    toOutputScript,
    toFutureOPNetAddress,
    _toFutureSegwitAddress,
    isUnknownSegwitVersion,
    FUTURE_SEGWIT_MAX_SIZE,
    FUTURE_SEGWIT_MIN_SIZE,
    FUTURE_SEGWIT_MAX_VERSION,
    FUTURE_MAX_VERSION,
    FUTURE_OPNET_VERSION,
    FUTURE_SEGWIT_MIN_VERSION,
    FUTURE_SEGWIT_VERSION_DIFF,
} from '@btc-vision/bitcoin';

// Types
import type {
    Base58CheckResult,
    Bech32Result,
    ToOutputScriptOptions,
} from '@btc-vision/bitcoin';
```

---

## Interfaces

### Base58CheckResult

Returned by `fromBase58Check()` when decoding a legacy Base58Check address.

```typescript
interface Base58CheckResult {
    /** The 20-byte address hash (HASH160 of public key or script) */
    readonly hash: Bytes20;
    /** The version byte: 0x00 for P2PKH, 0x05 for P2SH (mainnet) */
    readonly version: number;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `hash` | `Bytes20` | 20-byte HASH160 payload |
| `version` | `number` | Version prefix byte identifying the address type and network |

### Bech32Result

Returned by `fromBech32()` when decoding a Bech32 or Bech32m address.

```typescript
interface Bech32Result {
    /** Witness version: 0 for P2WPKH/P2WSH, 1 for P2TR, 2 for P2MR, 16 for P2OP */
    version: number;
    /** Human-readable prefix: "bc" for mainnet, "tb" for testnet, "bcrt" for regtest */
    prefix: string;
    /** Witness program: 20 bytes for P2WPKH, 32 bytes for P2WSH/P2TR/P2MR */
    data: Uint8Array;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | SegWit witness version (0-16) |
| `prefix` | `string` | Bech32 human-readable part (e.g., `"bc"`, `"tb"`, `"op"`) |
| `data` | `Uint8Array` | Decoded witness program bytes |

### ToOutputScriptOptions

Options object for `toOutputScript()`.

```typescript
interface ToOutputScriptOptions {
    /** Network to use for encoding. Defaults to bitcoin mainnet. */
    readonly network?: Network;
    /**
     * Optional callback for future segwit version warnings.
     * Called with a warning string when encoding a future segwit version (v2-v15) address.
     */
    readonly onFutureSegwitWarning?: (warning: string) => void;
}
```

---

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `FUTURE_SEGWIT_MAX_SIZE` | `40` | Maximum witness program length for future SegWit versions |
| `FUTURE_SEGWIT_MIN_SIZE` | `2` | Minimum witness program length for future SegWit versions |
| `FUTURE_SEGWIT_MAX_VERSION` | `15` | Maximum SegWit version for standard future addresses |
| `FUTURE_MAX_VERSION` | `16` | Maximum SegWit version (including OPNet) |
| `FUTURE_OPNET_VERSION` | `16` | SegWit version reserved for OPNet (P2OP) |
| `FUTURE_SEGWIT_MIN_VERSION` | `2` | Minimum SegWit version treated as "future" |
| `FUTURE_SEGWIT_VERSION_DIFF` | `0x50` | Offset between SegWit version number and the corresponding opcode (`OP_1` = `0x51`, so version 1 = `0x51 - 0x50`) |

---

## API Reference

### fromBase58Check()

Decodes a Base58Check-encoded address into its version byte and 20-byte hash.

```typescript
function fromBase58Check(address: string): Base58CheckResult
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `string` | A Base58Check-encoded address string |

**Returns:** `Base58CheckResult` with `version` and `hash` fields.

**Throws:** `TypeError` if the decoded payload is not exactly 21 bytes.

#### Example

```typescript
import { address } from '@btc-vision/bitcoin';

// Decode a P2PKH mainnet address
const result = address.fromBase58Check('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
console.log(result.version); // 0 (P2PKH mainnet)
console.log(result.hash);    // Uint8Array(20) - the HASH160

// Decode a P2SH mainnet address
const p2shResult = address.fromBase58Check('3LRW7jeCvQCRdPF8S3yUCfRAx4eqXFmdcr');
console.log(p2shResult.version); // 5 (P2SH mainnet)

// Decode a testnet P2PKH address
const testnetResult = address.fromBase58Check('mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r');
console.log(testnetResult.version); // 111 (0x6f, testnet P2PKH)
```

---

### toBase58Check()

Encodes a 20-byte hash and version byte into a Base58Check address string.

```typescript
function toBase58Check(hash: Bytes20, version: number): string
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `hash` | `Bytes20` | 20-byte hash (HASH160 of public key or script) |
| `version` | `number` | Version byte (must be a valid UInt8, 0-255) |

**Returns:** Base58Check-encoded address string.

**Throws:** `TypeError` if `hash` is not exactly 20 bytes or `version` is not a valid UInt8.

#### Example

```typescript
import { address, networks } from '@btc-vision/bitcoin';
import { fromHex } from '@btc-vision/bitcoin';
import type { Bytes20 } from '@btc-vision/bitcoin';

const hash = fromHex('751e76e8199196d454941c45d1b3a323f1433bd6') as Bytes20;

// Encode as P2PKH mainnet (version 0x00)
const p2pkhAddress = address.toBase58Check(hash, networks.bitcoin.pubKeyHash);
console.log(p2pkhAddress); // '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'

// Encode as P2SH mainnet (version 0x05)
const p2shHash = fromHex('cd7b44d0b03f2d026d1e586d7ae18903b0d385f6') as Bytes20;
const p2shAddress = address.toBase58Check(p2shHash, networks.bitcoin.scriptHash);
console.log(p2shAddress); // '3LRW7jeCvQCRdPF8S3yUCfRAx4eqXFmdcr'

// Encode as testnet P2PKH (version 0x6f)
const testnetAddress = address.toBase58Check(hash, networks.testnet.pubKeyHash);
console.log(testnetAddress); // 'mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r'
```

---

### fromBech32()

Decodes a Bech32 or Bech32m address into its witness version, human-readable prefix, and witness program data. Automatically detects whether the address uses Bech32 (version 0) or Bech32m (version 1+).

```typescript
function fromBech32(address: string): Bech32Result
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `string` | A Bech32 or Bech32m encoded address |

**Returns:** `Bech32Result` with `version`, `prefix`, and `data` fields.

**Throws:** `TypeError` if the encoding is mismatched (e.g., Bech32 with version != 0, or Bech32m with version 0).

#### Example

```typescript
import { address } from '@btc-vision/bitcoin';

// Decode a P2WPKH address (SegWit v0, Bech32)
const wpkh = address.fromBech32('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
console.log(wpkh.version); // 0
console.log(wpkh.prefix);  // 'bc'
console.log(wpkh.data);    // Uint8Array(20)

// Decode a P2WSH address (SegWit v0, Bech32)
const wsh = address.fromBech32(
    'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7'
);
console.log(wsh.version); // 0
console.log(wsh.prefix);  // 'tb'
console.log(wsh.data);    // Uint8Array(32)

// Decode a P2TR address (SegWit v1, Bech32m)
const tr = address.fromBech32(
    'bc1p3efq8ujsj0qr5xvms7mv89p8cz0crqdtuxe9ms6grqgxc9sgsntslthf6w'
);
console.log(tr.version); // 1
console.log(tr.prefix);  // 'bc'
console.log(tr.data);    // Uint8Array(32) - x-only public key

// Decode a P2MR address (SegWit v2, Bech32m, 32-byte program)
const mr = address.fromBech32('bc1z3efq8ujsj0qr5xvms7mv89p8cz0crqdtuxe9ms6grqgxc9sgsntssjqzpz');
console.log(mr.version); // 2
console.log(mr.prefix);  // 'bc'
console.log(mr.data.length); // 32
```

---

### toBech32()

Encodes witness program data into a Bech32 (version 0) or Bech32m (version 1+) address string. When the version is `FUTURE_OPNET_VERSION` (16) and an OPNet prefix is provided, the address is encoded with the OPNet prefix.

```typescript
function toBech32(
    data: Uint8Array,
    version: number,
    prefix: string,
    prefixOpnet?: string,
): string
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Witness program bytes |
| `version` | `number` | SegWit witness version (0-16) |
| `prefix` | `string` | Bech32 human-readable prefix (e.g., `"bc"`, `"tb"`) |
| `prefixOpnet` | `string` (optional) | OPNet-specific prefix, used when version is 16 |

**Returns:** Encoded Bech32 or Bech32m address string.

#### Example

```typescript
import { address, networks } from '@btc-vision/bitcoin';
import { fromHex } from '@btc-vision/bitcoin';

// Encode a P2WPKH address (version 0 uses Bech32)
const wpkhData = fromHex('751e76e8199196d454941c45d1b3a323f1433bd6');
const wpkhAddr = address.toBech32(wpkhData, 0, networks.bitcoin.bech32);
console.log(wpkhAddr); // 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

// Encode a P2TR address (version 1 uses Bech32m)
const trData = fromHex(
    '8e5203f25093c03a199b87b6c39427c09f8181abe1b25dc34818106c160884d7'
);
const trAddr = address.toBech32(trData, 1, networks.bitcoin.bech32);
console.log(trAddr); // 'bc1p3efq8ujsj0qr5xvms7mv89p8cz0crqdtuxe9ms6grqgxc9sgsntslthf6w'

// Encode a P2MR address (version 2 uses Bech32m, 32-byte program required)
const mrData = fromHex(
    '8e5203f25093c03a199b87b6c39427c09f8181abe1b25dc34818106c160884d7'
);
const mrAddr = address.toBech32(mrData, 2, networks.bitcoin.bech32);
console.log(mrAddr); // 'bc1z3efq8ujsj0qr5xvms7mv89p8cz0crqdtuxe9ms6grqgxc9sgsntssjqzpz'

// Encode a testnet address
const testnetAddr = address.toBech32(wpkhData, 0, networks.testnet.bech32);
console.log(testnetAddr); // 'tb1q...'

// Encode a P2OP (OPNet) address (version 16 uses bech32Opnet prefix)
const opData = fromHex('751e');
const opAddr = address.toBech32(opData, 16, networks.bitcoin.bech32, networks.bitcoin.bech32Opnet);
console.log(opAddr); // 'op1sw50qcspuvz'
```

---

### fromOutputScript()

Converts an output script (`scriptPubKey`) into its corresponding address string. Uses fast byte-pattern matching for common script types (P2PKH, P2SH, P2WPKH, P2WSH, P2TR, P2MR) and falls back to payment constructors for exotic types like P2OP and future SegWit.

```typescript
function fromOutputScript(output: Uint8Array | Script, network?: Network): string
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `output` | `Uint8Array \| Script` | The output script (scriptPubKey) bytes |
| `network` | `Network` (optional) | Network configuration. Defaults to `networks.bitcoin`. |

**Returns:** The address string corresponding to the output script.

**Throws:** `Error` if the output script does not match any known address format.

#### Example

```typescript
import { address, networks, script } from '@btc-vision/bitcoin';

// P2PKH output script to address
const p2pkhScript = script.fromASM(
    'OP_DUP OP_HASH160 751e76e8199196d454941c45d1b3a323f1433bd6 OP_EQUALVERIFY OP_CHECKSIG'
);
const p2pkhAddr = address.fromOutputScript(p2pkhScript);
console.log(p2pkhAddr); // '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'

// P2SH output script to address
const p2shScript = script.fromASM(
    'OP_HASH160 cd7b44d0b03f2d026d1e586d7ae18903b0d385f6 OP_EQUAL'
);
const p2shAddr = address.fromOutputScript(p2shScript);
console.log(p2shAddr); // '3LRW7jeCvQCRdPF8S3yUCfRAx4eqXFmdcr'

// P2WPKH output script to address
const p2wpkhScript = script.fromASM(
    'OP_0 751e76e8199196d454941c45d1b3a323f1433bd6'
);
const p2wpkhAddr = address.fromOutputScript(p2wpkhScript);
console.log(p2wpkhAddr); // 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

// P2TR output script to address
const p2trScript = script.fromASM(
    'OP_1 8e5203f25093c03a199b87b6c39427c09f8181abe1b25dc34818106c160884d7'
);
const p2trAddr = address.fromOutputScript(p2trScript);
console.log(p2trAddr); // 'bc1p3efq8ujsj0qr5xvms7mv89p8cz0crqdtuxe9ms6grqgxc9sgsntslthf6w'

// P2MR output script to address (must be 34 bytes: OP_2 + 32-byte push)
const p2mrScript = script.fromASM(
    'OP_2 8e5203f25093c03a199b87b6c39427c09f8181abe1b25dc34818106c160884d7'
);
const p2mrAddr = address.fromOutputScript(p2mrScript);
console.log(p2mrAddr); // 'bc1z3efq8ujsj0qr5xvms7mv89p8cz0crqdtuxe9ms6grqgxc9sgsntssjqzpz'

// Using a specific network
const testnetScript = script.fromASM(
    'OP_0 751e76e8199196d454941c45d1b3a323f1433bd6'
);
const testnetAddr = address.fromOutputScript(testnetScript, networks.testnet);
console.log(testnetAddr); // 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
```

---

### toOutputScript()

Converts an address string into its corresponding output script (`scriptPubKey`). Accepts either a `Network` object or a `ToOutputScriptOptions` object as the second parameter.

```typescript
function toOutputScript(
    address: string,
    networkOrOptions?: Network | ToOutputScriptOptions,
): Script
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `string` | The address to convert |
| `networkOrOptions` | `Network \| ToOutputScriptOptions` (optional) | Network or options object. Defaults to `networks.bitcoin`. |

**Returns:** The output script as `Script`.

**Throws:** `TypeError` if the address does not match any known script pattern for the given network.

#### Example: Basic Usage

```typescript
import { address, script, networks } from '@btc-vision/bitcoin';

// P2PKH address to output script
const p2pkhOutput = address.toOutputScript('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
console.log(script.toASM(p2pkhOutput));
// 'OP_DUP OP_HASH160 751e76e8199196d454941c45d1b3a323f1433bd6 OP_EQUALVERIFY OP_CHECKSIG'

// P2SH address to output script
const p2shOutput = address.toOutputScript('3LRW7jeCvQCRdPF8S3yUCfRAx4eqXFmdcr');
console.log(script.toASM(p2shOutput));
// 'OP_HASH160 cd7b44d0b03f2d026d1e586d7ae18903b0d385f6 OP_EQUAL'

// P2WPKH address to output script
const wpkhOutput = address.toOutputScript(
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
);
console.log(script.toASM(wpkhOutput));
// 'OP_0 751e76e8199196d454941c45d1b3a323f1433bd6'

// P2TR address to output script
const trOutput = address.toOutputScript(
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'
);
console.log(script.toASM(trOutput));
// 'OP_1 79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
```

#### Example: With Network

```typescript
import { address, script, networks } from '@btc-vision/bitcoin';

// Testnet P2PKH
const testnetOutput = address.toOutputScript(
    'mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r',
    networks.testnet,
);
console.log(script.toASM(testnetOutput));
// 'OP_DUP OP_HASH160 751e76e8199196d454941c45d1b3a323f1433bd6 OP_EQUALVERIFY OP_CHECKSIG'

// Testnet P2SH
const testnetP2sh = address.toOutputScript(
    '2NByiBUaEXrhmqAsg7BbLpcQSAQs1EDwt5w',
    networks.testnet,
);
console.log(script.toASM(testnetP2sh));
// 'OP_HASH160 cd7b44d0b03f2d026d1e586d7ae18903b0d385f6 OP_EQUAL'
```

#### Example: With ToOutputScriptOptions

```typescript
import { address, networks } from '@btc-vision/bitcoin';

// Use the options form to capture future segwit version warnings
const output = address.toOutputScript('bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs', {
    network: networks.bitcoin,
    onFutureSegwitWarning: (warning) => {
        console.warn('Segwit warning:', warning);
        // WARNING: Sending to a future segwit version address can lead to loss of funds...
    },
});
```

#### Address Type Routing

`toOutputScript` automatically routes addresses to the correct payment constructor:

| Decoded Result | Condition | Payment Constructor |
|----------------|-----------|-------------------|
| Base58Check, version = `pubKeyHash` | Version matches network | `p2pkh()` |
| Base58Check, version = `scriptHash` | Version matches network | `p2sh()` |
| Bech32, version 0, 20-byte data | | `p2wpkh()` |
| Bech32, version 0, 32-byte data | | `p2wsh()` |
| Bech32m, version 1, 32-byte data | | `p2tr()` |
| Bech32m, version 2, 32-byte data | | `p2mr()` |
| Bech32m, version 16 | Network has `bech32Opnet` defined | `p2op()` |
| Bech32m, version 2-15, 2-40 byte data | Future SegWit | Raw `OP_n <data>` script |

---

### toFutureOPNetAddress()

Encodes an output script into a future OPNet address using Bech32m. This handles witness versions 15-16 with the OPNet-specific Bech32m prefix (`bech32Opnet`). The function parses the opcode and push-data from the raw output script to extract the witness version and program.

```typescript
function toFutureOPNetAddress(output: Uint8Array, network: Network): string
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `output` | `Uint8Array` | Output script buffer containing version opcode and witness program |
| `network` | `Network` | Network object (must have `bech32Opnet` defined) |

**Returns:** Bech32m-encoded OPNet address string.

**Throws:**
- `TypeError` if `output` is not a `Uint8Array`
- `Error` if the network does not support OPNet (`bech32Opnet` is falsy)
- `TypeError` if the program length is outside the valid range (2-40 bytes)
- `TypeError` if the witness version is outside the valid range (15-16)

#### Example

```typescript
import { address, networks, script } from '@btc-vision/bitcoin';

// Build a P2OP output script: OP_16 <program>
const opScript = script.fromASM('OP_16 751e');
const opAddress = address.toFutureOPNetAddress(opScript, networks.bitcoin);
console.log(opAddress); // 'op1sw50qcspuvz'
```

---

### _toFutureSegwitAddress()

Encodes an output script for future SegWit versions (v2-v15) into a Bech32m address. This is an internal helper used by `fromOutputScript()` as a fallback for non-standard future SegWit scripts. The function expects the output script to be in the format `[version_opcode, data_length, ...data]`.

```typescript
function _toFutureSegwitAddress(output: Uint8Array, network: Network): string
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `output` | `Uint8Array` | Output script with version opcode at byte 0, length at byte 1, then data |
| `network` | `Network` | Network object with `bech32` prefix |

**Returns:** Bech32m-encoded address string.

**Throws:**
- `TypeError` if the program length is outside 2-40 bytes
- `TypeError` if the version is outside 2-15
- `TypeError` if byte 1 does not match the actual data length

#### Example

```typescript
import { address, networks } from '@btc-vision/bitcoin';

// Build a raw future segwit output: OP_2 (0x52) + length + data
const output = new Uint8Array([
    0x52,  // OP_2
    0x10,  // 16 bytes of data
    0x75, 0x1e, 0x76, 0xe8, 0x19, 0x91, 0x96, 0xd4,
    0x54, 0x94, 0x1c, 0x45, 0xd1, 0xb3, 0xa3, 0x23,
]);
const addr = address._toFutureSegwitAddress(output, networks.bitcoin);
console.log(addr); // 'bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs'
```

---

### isUnknownSegwitVersion()

Checks whether an output script corresponds to an unknown (future) SegWit version. Returns `true` if the script has a valid future SegWit structure (version 2-16, program length 2-40 bytes), excluding version 1 (Taproot, which is a known version).

```typescript
const isUnknownSegwitVersion: (output: Uint8Array) => boolean
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `output` | `Uint8Array` | The output script to check |

**Returns:** `true` if the script matches a future/unknown SegWit version pattern, `false` otherwise.

#### Example

```typescript
import { address, script } from '@btc-vision/bitcoin';

// A SegWit v2 output is considered "unknown" (future)
const v2Script = new Uint8Array([
    0x52,  // OP_2
    0x10,  // 16 bytes
    0x75, 0x1e, 0x76, 0xe8, 0x19, 0x91, 0x96, 0xd4,
    0x54, 0x94, 0x1c, 0x45, 0xd1, 0xb3, 0xa3, 0x23,
]);
console.log(address.isUnknownSegwitVersion(v2Script)); // true

// A SegWit v0 output (P2WPKH) is NOT unknown
const v0Script = new Uint8Array([
    0x00,  // OP_0
    0x14,  // 20 bytes
    ...new Uint8Array(20),
]);
console.log(address.isUnknownSegwitVersion(v0Script)); // false

// A SegWit v1 output (Taproot) is NOT unknown (it's recognized)
const v1Script = new Uint8Array([
    0x51,  // OP_1
    0x20,  // 32 bytes
    ...new Uint8Array(32),
]);
console.log(address.isUnknownSegwitVersion(v1Script)); // false
```

---

## Complete Workflow Examples

### Round-Trip: Address to Script and Back

```typescript
import { address, script, networks } from '@btc-vision/bitcoin';

const originalAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

// Address -> Output Script
const outputScript = address.toOutputScript(originalAddress);
console.log(script.toASM(outputScript));
// 'OP_0 751e76e8199196d454941c45d1b3a323f1433bd6'

// Output Script -> Address
const recoveredAddress = address.fromOutputScript(outputScript);
console.log(recoveredAddress === originalAddress); // true
```

### Detecting Address Type from a String

```typescript
import { address } from '@btc-vision/bitcoin';

function getAddressType(addr: string): string {
    // Try Base58Check first
    try {
        const decoded = address.fromBase58Check(addr);
        if (decoded.version === 0x00) return 'P2PKH';
        if (decoded.version === 0x05) return 'P2SH';
        return `Base58Check (version ${decoded.version})`;
    } catch {}

    // Try Bech32/Bech32m
    try {
        const decoded = address.fromBech32(addr);
        if (decoded.version === 0 && decoded.data.length === 20) return 'P2WPKH';
        if (decoded.version === 0 && decoded.data.length === 32) return 'P2WSH';
        if (decoded.version === 1 && decoded.data.length === 32) return 'P2TR';
        if (decoded.version === 2 && decoded.data.length === 32) return 'P2MR';
        if (decoded.version === 16) return 'P2OP';
        return `Future SegWit v${decoded.version}`;
    } catch {}

    return 'Unknown';
}

console.log(getAddressType('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'));          // 'P2PKH'
console.log(getAddressType('3LRW7jeCvQCRdPF8S3yUCfRAx4eqXFmdcr'));          // 'P2SH'
console.log(getAddressType('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')); // 'P2WPKH'
console.log(getAddressType('bc1p3efq8ujsj0qr5xvms7mv89p8cz0crqdtuxe9ms6grqgxc9sgsntslthf6w')); // 'P2TR'
console.log(getAddressType('bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs'));        // 'P2MR'
```

### Multi-Network Address Generation

```typescript
import { address, networks } from '@btc-vision/bitcoin';
import type { Bytes20 } from '@btc-vision/bitcoin';
import { fromHex } from '@btc-vision/bitcoin';

const pubkeyHash = fromHex('751e76e8199196d454941c45d1b3a323f1433bd6') as Bytes20;

// Same hash, different networks produce different addresses
const mainnet = address.toBase58Check(pubkeyHash, networks.bitcoin.pubKeyHash);
const testnet = address.toBase58Check(pubkeyHash, networks.testnet.pubKeyHash);
const regtest = address.toBase58Check(pubkeyHash, networks.regtest.pubKeyHash);

console.log(mainnet); // '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'
console.log(testnet); // 'mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r'
console.log(regtest); // 'mrCDrCybB6J1vRfbwM5hemdJz73FwDBC8r' (same version as testnet)

// SegWit addresses use the bech32 prefix
const mainnetBech32 = address.toBech32(pubkeyHash, 0, networks.bitcoin.bech32);
const testnetBech32 = address.toBech32(pubkeyHash, 0, networks.testnet.bech32);
const regtestBech32 = address.toBech32(pubkeyHash, 0, networks.regtest.bech32);

console.log(mainnetBech32); // 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
console.log(testnetBech32); // 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
console.log(regtestBech32); // 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7k0fey5p'
```

### Handling Future SegWit Version Warnings

```typescript
import { address, networks } from '@btc-vision/bitcoin';

// When decoding a future segwit address, you may want to warn users
const futureAddr = 'bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs';

const output = address.toOutputScript(futureAddr, {
    network: networks.bitcoin,
    onFutureSegwitWarning: (warning: string) => {
        // Display this warning to the user before proceeding
        console.warn(warning);
        // "WARNING: Sending to a future segwit version address can lead to loss of funds..."
    },
});
```

### Using with Payment Constructors

```typescript
import { payments, address, networks } from '@btc-vision/bitcoin';

// Generate address from a payment, then convert back to script
const payment = payments.p2wpkh({
    hash: fromHex('751e76e8199196d454941c45d1b3a323f1433bd6') as Bytes20,
});
console.log(payment.address); // 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

// Convert the address back to the output script
const outputScript = address.toOutputScript(payment.address!);
// outputScript is identical to payment.output
```

---

## Error Handling

All address functions throw typed errors for invalid input:

```typescript
import { address } from '@btc-vision/bitcoin';

// Base58Check: too short
try {
    address.fromBase58Check('7SeEnXWPaCCALbVrTnszCVGfRU8cGfx');
} catch (e) {
    console.log(e.message); // '7SeEnXWPaCCALbVrTnszCVGfRU8cGfx is too short'
}

// Base58Check: too long
try {
    address.fromBase58Check('j9ywUkWg2fTQrouxxh5rSZhRvrjMkEUfuiKe');
} catch (e) {
    console.log(e.message); // 'j9ywUkWg2fTQrouxxh5rSZhRvrjMkEUfuiKe is too long'
}

// Bech32: wrong encoding (bech32 used with non-zero version)
try {
    address.fromBech32('bc1zw508d6qejxtdg4y5r3zarvaryvqyzf3du');
} catch (e) {
    console.log(e.message); // '... uses wrong encoding'
}

// toOutputScript: no matching script
try {
    address.toOutputScript('24kPZCmVgzfkpGdXExy56234MRHrsqQxNWE');
} catch (e) {
    console.log(e.message); // '24kPZCmVgzfkpGdXExy56234MRHrsqQxNWE has no matching Script'
}

// toOutputScript: invalid prefix for network
try {
    address.toOutputScript('bc1sw50qgdz25j', { bech32: 'foo' } as any);
} catch (e) {
    console.log(e.message); // 'bc1sw50qgdz25j has an invalid prefix'
}

// fromOutputScript: unrecognized script
try {
    address.fromOutputScript(new Uint8Array([0xff, 0x00]));
} catch (e) {
    console.log(e.message); // '... has no matching Address'
}
```

---

## Script Pattern Detection (Internal)

`fromOutputScript()` uses fast byte-level matching for performance. Here are the exact patterns it checks, in order:

| Type | Length | Byte 0 | Byte 1 | Byte 2 | Tail Bytes |
|------|--------|--------|--------|--------|------------|
| P2PKH | 25 | `0x76` (OP_DUP) | `0xa9` (OP_HASH160) | `0x14` (push 20) | `[23]=0x88, [24]=0xac` |
| P2SH | 23 | `0xa9` (OP_HASH160) | `0x14` (push 20) | - | `[22]=0x87` |
| P2WPKH | 22 | `0x00` (OP_0) | `0x14` (push 20) | - | - |
| P2WSH | 34 | `0x00` (OP_0) | `0x20` (push 32) | - | - |
| P2TR | 34 | `0x51` (OP_1) | `0x20` (push 32) | - | - |
| P2MR | 34 | `0x52` (OP_2) | `0x20` (push 32) | - | - |

If none of these match, it falls back to `toFutureOPNetAddress()` and then `_toFutureSegwitAddress()`.
