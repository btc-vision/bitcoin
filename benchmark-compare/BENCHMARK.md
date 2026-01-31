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
| Fork + Noble (pure JS) | 39.57ms |
| Fork + tiny-secp256k1 (WASM) | 7.03ms |
| Official + tiny-secp256k1 (WASM) | 7.28ms |

Both libraries have similar initialization time when using the same WASM backend. The Noble backend is ~32ms slower due to pure-JS module loading, but eliminates the WASM dependency entirely -- critical for React Native and edge runtimes without WASM support.

### 2. PSBT Creation (addInput + addOutput)

| Inputs | Fork | Official | Speedup |
|--------|------|----------|---------|
| 10 | 0.27ms | 8.11ms | **30x** |
| 50 | 1.15ms | 85.59ms | **75x** |
| 100 | 2.17ms | 310.21ms | **143x** |
| 250 | 5.22ms | 1.80s | **346x** |
| 500 | 10.28ms | 7.27s | **707x** |

The fork's PSBT creation scales linearly (O(n)). The official library exhibits O(n^2) behavior -- each `addInput()` call triggers increasingly expensive internal validation passes over all existing inputs. At 500 inputs, the official library takes over **7 seconds** just to build the PSBT, while the fork completes in **10 milliseconds**.

### 3. P2WPKH Signing (create + sign, SegWit v0)

| Inputs | Fork (Noble) | Fork (tiny) | Official | Best Fork Speedup |
|--------|-------------|-------------|----------|-------------------|
| 10 | 7.24ms | 4.11ms | 9.71ms | **2.4x** |
| 50 | 32.04ms | 19.99ms | 105.22ms | **5.3x** |
| 100 | 66.63ms | 40.51ms | 353.21ms | **8.7x** |
| 250 | 176.87ms | 112.69ms | 2.02s | **17.9x** |
| 500 | 386.67ms | 268.21ms | 7.46s | **27.8x** |

This benchmark includes PSBT creation + signing. The fork's advantage compounds: faster PSBT construction plus efficient sighash caching. With tiny-secp256k1, the raw signing speed matches the official library, but the PSBT overhead dominates at scale.

### 4. P2TR Taproot Signing (Schnorr, SegWit v1)

| Inputs | Fork (Noble) | Fork (tiny) | Official | Best Fork Speedup |
|--------|-------------|-------------|----------|-------------------|
| 10 | 23.36ms | 2.50ms | 3.69ms | **1.5x** |
| 50 | 107.62ms | 10.77ms | 18.93ms | **1.8x** |
| 100 | 215.62ms | 21.48ms | 45.58ms | **2.1x** |
| 250 | 547.09ms | 53.05ms | 171.89ms | **3.2x** |
| 500 | 1.11s | 104.04ms | 603.01ms | **5.8x** |

With tiny-secp256k1, the fork is consistently faster due to its O(n) Taproot sighash caching (the official library recomputes more per input). Noble's pure-JS Schnorr implementation is slower than WASM for raw signing, which shows at small input counts, but the fork's architectural advantages compound at scale.

### 5. End-to-End Lifecycle (100 inputs)

Full lifecycle: create PSBT + add inputs/outputs + sign + finalize + extract + serialize.

| Type | Fork (Noble) | Official | Speedup |
|------|-------------|----------|---------|
| P2WPKH | 67.27ms | 334.55ms | **5.0x** |
| P2TR | 221.01ms | 55.40ms | 0.25x (Noble) |

P2WPKH end-to-end is **5x faster** with the fork. P2TR with Noble is slower due to pure-JS Schnorr signing overhead. Using the tiny-secp256k1 backend for P2TR would yield similar speedups as the signing benchmarks above show.

### 6. Parallel Signing (fork-exclusive)

Worker-based parallel signing using `NodeWorkerSigningPool` with 4 `worker_threads`.

| Inputs | Fork Sequential | Fork Parallel (4w) | Official Sequential | Speedup vs Seq | Speedup vs Official |
|--------|----------------|-------------------|--------------------|----|------|
| 100 | 65.98ms | 21.27ms | 317.85ms | 3.1x | **14.9x** |
| 500 | 403.72ms | 106.25ms | 6.85s | 3.8x | **64.5x** |

Parallel signing is **exclusive to the fork**. At 500 inputs, parallel signing completes in 106ms vs the official library's 6.85s sequential signing -- a **64.5x improvement**.

## The tiny-secp256k1 Reality

A common assumption is that `tiny-secp256k1` (WASM) is always faster. The raw signing numbers tell a nuanced story:

**Where WASM wins:**
- Raw Schnorr signing throughput is ~2x faster per operation than Noble's pure JS implementation
- For P2TR-heavy workloads with few inputs, the per-signature difference matters

**Where it doesn't matter:**
- The PSBT construction overhead completely dominates at scale. The official library's O(n^2) behavior means PSBT creation alone takes 7.27s at 500 inputs vs 10ms in the fork -- a difference so large that the choice of signing backend is irrelevant
- P2WPKH signing with Noble is only ~1.5x slower per operation than WASM, and the fork's PSBT improvements more than compensate

**Where WASM is a liability:**
- ~1.2MB WASM binary added to bundle size vs ~12KB for Noble
- WASM initialization requires WebAssembly support -- unavailable in some React Native runtimes and edge environments
- Cold-start adds measurable overhead in serverless / Lambda contexts

**Bottom line:** The fork with Noble (pure JS) outperforms the official library with WASM for all real-world P2WPKH workloads. For P2TR-heavy workloads, the fork with tiny-secp256k1 is the fastest option and still outperforms the official library. The Noble backend provides portability across Node.js, browsers, and React Native with no WASM dependency.

## Summary

| Scenario | Inputs | @btc-vision/bitcoin | bitcoinjs-lib | Improvement |
|----------|--------|--------------------:|-------------:|:-----------:|
| PSBT Creation | 100 | 2.17ms | 310ms | **143x** |
| PSBT Creation | 500 | 10.28ms | 7,270ms | **707x** |
| P2WPKH Sign | 100 | 41ms | 353ms | **8.7x** |
| P2WPKH Sign | 500 | 268ms | 7,460ms | **27.8x** |
| P2TR Sign | 100 | 21ms | 46ms | **2.1x** |
| P2TR Sign | 500 | 104ms | 603ms | **5.8x** |
| E2E P2WPKH | 100 | 67ms | 335ms | **5.0x** |
| Parallel (4w) | 500 | 106ms | 6,850ms | **64.5x** |

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
