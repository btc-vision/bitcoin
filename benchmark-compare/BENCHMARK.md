# Benchmark: @btc-vision/bitcoin vs bitcoinjs-lib vs @scure/btc-signer

Comprehensive performance comparison between `@btc-vision/bitcoin` (this fork), the official `bitcoinjs-lib` v7.0.1, and `@scure/btc-signer`.

## Environment

| Property | Value |
|----------|-------|
| Node.js | v25.6.0 |
| OS | Linux 6.8.0-100-generic x64 |
| Libraries | `@btc-vision/bitcoin` 7.0.0-rc.1, `bitcoinjs-lib` 7.0.1, `@scure/btc-signer` latest |
| ECC backends | `@noble/secp256k1` 3.x (pure JS), `tiny-secp256k1` 2.2.4 (WASM), `@noble/curves` (scure built-in) |

## Methodology

- **Warmup**: 5 iterations (discarded) before each measurement
- **Iterations**: 30 for small inputs, 10 for 250 inputs, 5 for 500 inputs
- **Metric**: Median of all iterations (resistant to outlier spikes)
- **Fairness**: All libraries use identical key material derived from the same seed. Each scenario builds its own PSBTs/transactions with the correct types for each library.
- **Cold-start**: Library initialization measured via separate Node.js subprocess per iteration for true cold-start timing.
- **ECC backends**: The fork is tested with both Noble (pure JS) and tiny-secp256k1 (WASM). The official library only supports tiny-secp256k1. Scure uses its built-in `@noble/curves` backend.

## Results

### 1. Library Initialization (cold-start)

| Configuration | Median |
|--------------|--------|
| Fork + Noble (pure JS) | 53.44ms |
| Fork + tiny-secp256k1 (WASM) | 7.16ms |
| Scure (@noble/curves) | 26.27ms |
| Official + tiny-secp256k1 (WASM) | 7.16ms |

Both the fork and official library have identical initialization time when using the same WASM backend. Scure sits in the middle at ~26ms due to its pure-JS `@noble/curves` dependency. The Noble backend is ~53ms due to pure-JS module loading, but eliminates the WASM dependency entirely -- critical for React Native and edge runtimes without WASM support.

### 2. PSBT / Transaction Creation (addInput + addOutput)

| Inputs | Fork | Scure | Official | Fork Speedup |
|--------|------|-------|----------|:------------:|
| 10 | 0.26ms | 0.58ms | 6.40ms | **24x** |
| 50 | 1.09ms | 1.56ms | 83.80ms | **77x** |
| 100 | 2.08ms | 2.60ms | 303.32ms | **145x** |
| 250 | 4.96ms | 5.86ms | 1.73s | **349x** |
| 500 | 9.73ms | 11.07ms | 6.87s | **706x** |

The fork's PSBT creation scales linearly (O(n)). Scure's `Transaction` also scales linearly but is ~1.1-1.2x slower than the fork. The official library exhibits O(n^2) behavior -- each `addInput()` call triggers increasingly expensive internal validation passes over all existing inputs. At 500 inputs, the official library takes over **6.87 seconds** just to build the PSBT, while the fork completes in under **10 milliseconds** and scure in **11ms**.

### 3. P2WPKH Signing (create + sign, SegWit v0)

| Inputs | Fork (Noble) | Fork (tiny) | Scure | Official | Best Fork Speedup |
|--------|-------------|-------------|-------|----------|:-----------------:|
| 10 | 6.89ms | 4.04ms | 11.05ms | 9.36ms | **2.3x** |
| 50 | 31.33ms | 19.52ms | 54.85ms | 101.59ms | **5.2x** |
| 100 | 65.27ms | 39.96ms | 123.83ms | 348.15ms | **8.7x** |
| 250 | 171.40ms | 110.99ms | 413.48ms | 1.89s | **17x** |
| 500 | 378.57ms | 282.93ms | 1.20s | 7.25s | **25.6x** |

This benchmark includes PSBT/transaction creation + signing. The fork's advantage compounds: faster PSBT construction plus efficient sighash caching. Scure is ~3x slower than the fork (tiny) but still ~6x faster than official at 500 inputs. With tiny-secp256k1, the fork's raw signing speed matches the official library, but the PSBT overhead dominates at scale.

### 4. P2TR Taproot Signing (Schnorr, SegWit v1)

| Inputs | Fork (Noble) | Fork (tiny) | Scure | Official | Best Fork Speedup |
|--------|-------------|-------------|-------|----------|:-----------------:|
| 10 | 22.55ms | 2.44ms | 39.17ms | 3.62ms | **1.5x** |
| 50 | 105.59ms | 10.72ms | 197.94ms | 18.72ms | **1.7x** |
| 100 | 211.00ms | 21.33ms | 420.13ms | 44.27ms | **2.1x** |
| 250 | 520.22ms | 51.69ms | 1.24s | 171.77ms | **3.3x** |
| 500 | 1.04s | 102.31ms | 3.29s | 521.88ms | **5.1x** |

With tiny-secp256k1, the fork is consistently faster due to its O(n) Taproot sighash caching (the official library recomputes more per input). Scure is the slowest here at ~3.29s for 500 inputs, as its pure-JS Schnorr implementation carries significant per-signature overhead. Noble's pure-JS Schnorr is also slower than WASM for raw signing, which shows at small input counts, but the fork's architectural advantages compound at scale.

### 5. End-to-End Lifecycle (100 inputs)

Full lifecycle: create PSBT/tx + add inputs/outputs + sign + finalize + extract + serialize.

| Type | Fork (Noble) | Fork (tiny) | Scure | Official | Best Fork Speedup |
|------|-------------|-------------|-------|----------|:-----------------:|
| P2WPKH | 66.62ms | 41.13ms | 125.32ms | 341.76ms | **8.3x** |
| P2TR | 210.98ms | 21.60ms | 431.07ms | 55.12ms | **2.6x** |

P2WPKH end-to-end is **8.3x faster** with the fork (tiny-secp256k1 backend). Scure is ~3x slower than the fork but still ~2.7x faster than official for P2WPKH. For P2TR, the fork with tiny-secp256k1 is **2.6x faster** than official. Scure's pure-JS Schnorr signing makes it the slowest for Taproot at 431ms vs 22ms (fork tiny) and 55ms (official).

### 6. Parallel Signing (fork-exclusive)

Worker-based parallel signing using `NodeWorkerSigningPool` with 4 `worker_threads`.

| Inputs | Fork Sequential | Fork Parallel (4w) | Official Sequential | Speedup vs Seq | Speedup vs Official |
|--------|----------------|-------------------|--------------------|----|------|
| 100 | 64.27ms | 21.73ms | 310.42ms | 3.0x | **14.3x** |
| 500 | 380.27ms | 102.25ms | 6.47s | 3.7x | **63.3x** |

Parallel signing is **exclusive to the fork**. At 500 inputs, parallel signing completes in 102ms vs the official library's 6.47s sequential signing -- a **63.3x improvement**.

## Scure vs Official vs Fork

`@scure/btc-signer` sits between the fork and official library in most scenarios:

**Where Scure beats Official:**
- Transaction creation is O(n) like the fork, making it dramatically faster than official's O(n^2) PSBT creation at scale (11ms vs 6.87s at 500 inputs)
- P2WPKH signing is ~6x faster than official at 500 inputs, though ~4x slower than the fork

**Where Scure is slowest:**
- P2TR (Taproot) signing is the weakest spot -- 3.29s for 500 inputs vs 102ms (fork tiny) and 522ms (official). Its pure-JS Schnorr implementation has significant per-signature overhead
- No parallel signing support

**Bottom line:** Scure is a solid zero-dependency pure-JS option that avoids official's O(n^2) PSBT creation bottleneck, but its signing performance (especially Taproot) falls behind both the fork and official library.

## The tiny-secp256k1 Reality

A common assumption is that `tiny-secp256k1` (WASM) is always faster. The raw signing numbers tell a nuanced story:

**Where WASM wins:**
- Raw Schnorr signing throughput is ~2x faster per operation than Noble's pure JS implementation
- For P2TR-heavy workloads with few inputs, the per-signature difference matters

**Where it doesn't matter:**
- The PSBT construction overhead completely dominates at scale. The official library's O(n^2) behavior means PSBT creation alone takes 6.87s at 500 inputs vs 10ms in the fork -- a difference so large that the choice of signing backend is irrelevant
- P2WPKH signing with Noble is only ~1.5x slower per operation than WASM, and the fork's PSBT improvements more than compensate

**Where WASM is a liability:**
- ~1.2MB WASM binary added to bundle size vs ~12KB for Noble
- WASM initialization requires WebAssembly support -- unavailable in some React Native runtimes and edge environments
- Cold-start adds measurable overhead in serverless / Lambda contexts

**Bottom line:** The fork with Noble (pure JS) outperforms the official library with WASM for all real-world P2WPKH workloads. For P2TR-heavy workloads, the fork with tiny-secp256k1 is the fastest option and still outperforms both the official library and scure. The Noble backend provides portability across Node.js, browsers, and React Native with no WASM dependency.

## Summary

| Scenario | Inputs | @btc-vision/bitcoin | @scure/btc-signer | bitcoinjs-lib | Fork vs Official |
|----------|--------|--------------------:|------------------:|--------------:|:----------------:|
| PSBT Creation | 100 | 2.08ms | 2.60ms | 303ms | **145x** |
| PSBT Creation | 500 | 9.73ms | 11.07ms | 6,870ms | **706x** |
| P2WPKH Sign | 100 | 40ms | 124ms | 348ms | **8.7x** |
| P2WPKH Sign | 500 | 283ms | 1,200ms | 7,250ms | **25.6x** |
| P2TR Sign | 100 | 21ms | 420ms | 44ms | **2.1x** |
| P2TR Sign | 500 | 102ms | 3,290ms | 522ms | **5.1x** |
| E2E P2WPKH | 100 | 41ms | 125ms | 342ms | **8.3x** |
| E2E P2TR | 100 | 22ms | 431ms | 55ms | **2.6x** |
| Parallel (4w) | 500 | 102ms | N/A | 6,470ms | **63.3x** |

## How to Reproduce

```bash
cd benchmark-compare
npm install
npm run bench

# With GC control (recommended for stable results):
npm run bench:gc
```

The benchmark requires the parent project to be built first:

```bash
cd ..
npm run build
cd benchmark-compare
npm run bench
```
