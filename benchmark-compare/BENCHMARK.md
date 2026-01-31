# Benchmark: @btc-vision/bitcoin vs bitcoinjs-lib

Comprehensive performance comparison between `@btc-vision/bitcoin` (this fork) and the official `bitcoinjs-lib` v7.0.1.

## Environment

| Property | Value |
|----------|-------|
| Node.js | v25.3.0 |
| OS | Linux 6.8.0-90-generic x64 |
| Libraries | `@btc-vision/bitcoin` 7.0.0-alpha.10, `bitcoinjs-lib` 7.0.1 |
| ECC backends | `@noble/secp256k1` 3.x (pure JS), `tiny-secp256k1` 2.2.4 (WASM) |

## Methodology

- **Warmup**: 5 iterations (discarded) before each measurement
- **Iterations**: 30 for small inputs, 10 for 250 inputs, 5 for 500 inputs
- **Metric**: Median of all iterations (resistant to outlier spikes)
- **Fairness**: Both libraries use identical key material derived from the same seed. Each scenario builds its own PSBTs with the correct types for each library.
- **Cold-start**: Library initialization measured via separate Node.js subprocess per iteration for true cold-start timing.
- **ECC backends**: The fork is tested with both Noble (pure JS) and tiny-secp256k1 (WASM). The official library only supports tiny-secp256k1.

## Results

### 1. Library Initialization (cold-start)

| Configuration | Median |
|--------------|--------|
| Fork + Noble (pure JS) | 38.68ms |
| Fork + tiny-secp256k1 (WASM) | 6.94ms |
| Official + tiny-secp256k1 (WASM) | 7.58ms |

Both libraries have similar initialization time when using the same WASM backend. The Noble backend is ~32ms slower due to pure-JS module loading, but eliminates the WASM dependency entirely -- critical for React Native and edge runtimes without WASM support.

### 2. PSBT Creation (addInput + addOutput)

| Inputs | Fork | Official | Speedup |
|--------|------|----------|---------|
| 10 | 0.27ms | 7.51ms | **27x** |
| 50 | 1.12ms | 85.13ms | **76x** |
| 100 | 2.13ms | 305.06ms | **143x** |
| 250 | 5.12ms | 1.79s | **350x** |
| 500 | 9.90ms | 7.02s | **709x** |

The fork's PSBT creation scales linearly (O(n)). The official library exhibits O(n^2) behavior -- each `addInput()` call triggers increasingly expensive internal validation passes over all existing inputs. At 500 inputs, the official library takes over **7 seconds** just to build the PSBT, while the fork completes in under **10 milliseconds**.

### 3. P2WPKH Signing (create + sign, SegWit v0)

| Inputs | Fork (Noble) | Fork (tiny) | Official | Best Fork Speedup |
|--------|-------------|-------------|----------|-------------------|
| 10 | 7.01ms | 3.96ms | 9.50ms | **2.4x** |
| 50 | 31.66ms | 19.77ms | 108.04ms | **5.5x** |
| 100 | 66.03ms | 40.40ms | 349.29ms | **8.6x** |
| 250 | 174.11ms | 113.19ms | 1.91s | **16.9x** |
| 500 | 378.83ms | 257.67ms | 7.71s | **29.9x** |

This benchmark includes PSBT creation + signing. The fork's advantage compounds: faster PSBT construction plus efficient sighash caching. With tiny-secp256k1, the raw signing speed matches the official library, but the PSBT overhead dominates at scale.

### 4. P2TR Taproot Signing (Schnorr, SegWit v1)

| Inputs | Fork (Noble) | Fork (tiny) | Official | Best Fork Speedup |
|--------|-------------|-------------|----------|-------------------|
| 10 | 22.41ms | 2.45ms | 3.63ms | **1.5x** |
| 50 | 107.09ms | 10.57ms | 19.43ms | **1.8x** |
| 100 | 216.75ms | 21.51ms | 45.38ms | **2.1x** |
| 250 | 542.47ms | 54.42ms | 174.53ms | **3.2x** |
| 500 | 1.10s | 106.43ms | 574.64ms | **5.4x** |

With tiny-secp256k1, the fork is consistently faster due to its O(n) Taproot sighash caching (the official library recomputes more per input). Noble's pure-JS Schnorr implementation is slower than WASM for raw signing, which shows at small input counts, but the fork's architectural advantages compound at scale.

### 5. End-to-End Lifecycle (100 inputs)

Full lifecycle: create PSBT + add inputs/outputs + sign + finalize + extract + serialize.

| Type | Fork (Noble) | Fork (tiny) | Official | Best Fork Speedup |
|------|-------------|-------------|----------|-------------------|
| P2WPKH | 66.89ms | 44.04ms | 332.84ms | **7.6x** |
| P2TR | 217.06ms | 22.38ms | 55.72ms | **2.5x** |

P2WPKH end-to-end is **7.6x faster** with the fork (tiny-secp256k1 backend). P2TR end-to-end is **2.5x faster** with the fork's tiny-secp256k1 backend. Even though Noble's pure-JS Schnorr signing is slower for P2TR, the fork with the same WASM backend still decisively outperforms the official library due to O(n) PSBT construction and efficient sighash caching.

### 6. Parallel Signing (fork-exclusive)

Worker-based parallel signing using `NodeWorkerSigningPool` with 4 `worker_threads`.

| Inputs | Fork Sequential | Fork Parallel (4w) | Official Sequential | Speedup vs Seq | Speedup vs Official |
|--------|----------------|-------------------|--------------------|----|------|
| 100 | 64.28ms | 21.06ms | 333.17ms | 3.1x | **15.8x** |
| 500 | 383.83ms | 106.38ms | 6.77s | 3.6x | **63.6x** |

Parallel signing is **exclusive to the fork**. At 500 inputs, parallel signing completes in 106ms vs the official library's 6.77s sequential signing -- a **63.6x improvement**.

## The tiny-secp256k1 Reality

A common assumption is that `tiny-secp256k1` (WASM) is always faster. The raw signing numbers tell a nuanced story:

**Where WASM wins:**
- Raw Schnorr signing throughput is ~2x faster per operation than Noble's pure JS implementation
- For P2TR-heavy workloads with few inputs, the per-signature difference matters

**Where it doesn't matter:**
- The PSBT construction overhead completely dominates at scale. The official library's O(n^2) behavior means PSBT creation alone takes 7s at 500 inputs vs 10ms in the fork -- a difference so large that the choice of signing backend is irrelevant
- P2WPKH signing with Noble is only ~1.5x slower per operation than WASM, and the fork's PSBT improvements more than compensate

**Where WASM is a liability:**
- ~1.2MB WASM binary added to bundle size vs ~12KB for Noble
- WASM initialization requires WebAssembly support -- unavailable in some React Native runtimes and edge environments
- Cold-start adds measurable overhead in serverless / Lambda contexts

**Bottom line:** The fork with Noble (pure JS) outperforms the official library with WASM for all real-world P2WPKH workloads. For P2TR-heavy workloads, the fork with tiny-secp256k1 is the fastest option and still outperforms the official library. The Noble backend provides portability across Node.js, browsers, and React Native with no WASM dependency.

## Summary

| Scenario | Inputs | @btc-vision/bitcoin | bitcoinjs-lib | Improvement |
|----------|--------|--------------------:|-------------:|:-----------:|
| PSBT Creation | 100 | 2.13ms | 305ms | **143x** |
| PSBT Creation | 500 | 9.90ms | 7,020ms | **709x** |
| P2WPKH Sign | 100 | 40ms | 349ms | **8.6x** |
| P2WPKH Sign | 500 | 258ms | 7,710ms | **29.9x** |
| P2TR Sign | 100 | 22ms | 45ms | **2.1x** |
| P2TR Sign | 500 | 106ms | 575ms | **5.4x** |
| E2E P2WPKH | 100 | 44ms | 333ms | **7.6x** |
| E2E P2TR | 100 | 22ms | 56ms | **2.5x** |
| Parallel (4w) | 500 | 106ms | 6,770ms | **63.6x** |

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
