/**
 * Runtime capability verification and polyfills.
 *
 * Polyfills features that can be shimmed (TextEncoder, Map, Promise.allSettled, Symbol.dispose).
 * Throws early with a clear error for features that cannot be polyfilled (BigInt, Uint8Array,
 * structuredClone, DataView BigInt methods).
 *
 * Imported as a side effect by the main entry point.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Hard requirements — cannot be polyfilled
// ---------------------------------------------------------------------------

const missing: string[] = [];

if (typeof BigInt === 'undefined') {
    missing.push('BigInt (ES2020 — required for satoshi values)');
}

if (typeof Uint8Array === 'undefined') {
    missing.push('Uint8Array (TypedArrays — required for all binary operations)');
}

if (typeof DataView !== 'undefined' && typeof DataView.prototype.getBigInt64 !== 'function') {
    missing.push('DataView.prototype.getBigInt64 (ES2020 — required for transaction parsing)');
}

if (missing.length > 0) {
    throw new Error(
        `@btc-vision/bitcoin: unsupported runtime. Missing capabilities:\n` +
            missing.map((cap) => `  - ${cap}`).join('\n') +
            `\n\nThese features cannot be polyfilled. This library requires a modern JavaScript engine (ES2022+).`,
    );
}

// ---------------------------------------------------------------------------
// Polyfills — shim features that can be reasonably implemented
// ---------------------------------------------------------------------------

// TextEncoder / TextDecoder (for older WebView / jsdom environments)
if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = class TextEncoder {
        readonly encoding = 'utf-8';

        encode(input: string = ''): Uint8Array {
            // Fast path for ASCII
            const utf8: number[] = [];
            for (let i = 0; i < input.length; i++) {
                let code = input.charCodeAt(i);
                if (code < 0x80) {
                    utf8.push(code);
                } else if (code < 0x800) {
                    utf8.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
                } else if (code >= 0xd800 && code <= 0xdbff) {
                    // Surrogate pair
                    const next = input.charCodeAt(++i);
                    code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                    utf8.push(
                        0xf0 | (code >> 18),
                        0x80 | ((code >> 12) & 0x3f),
                        0x80 | ((code >> 6) & 0x3f),
                        0x80 | (code & 0x3f),
                    );
                } else {
                    utf8.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                }
            }
            return new Uint8Array(utf8);
        }

        encodeInto(src: string, dest: Uint8Array): { read: number; written: number } {
            const encoded = this.encode(src);
            const written = Math.min(encoded.length, dest.length);
            dest.set(encoded.subarray(0, written));
            return { read: src.length, written };
        }
    } as unknown as typeof TextEncoder;
}

if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
        readonly encoding = 'utf-8';
        readonly fatal = false;
        readonly ignoreBOM = false;

        decode(input?: ArrayBufferView | ArrayBuffer): string {
            if (!input) return '';
            const bytes =
                input instanceof ArrayBuffer
                    ? new Uint8Array(input)
                    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

            let result = '';
            for (let i = 0; i < bytes.length; ) {
                const byte = bytes[i] as number;
                let code: number;
                if (byte < 0x80) {
                    code = byte;
                    i++;
                } else if ((byte & 0xe0) === 0xc0) {
                    code = ((byte & 0x1f) << 6) | ((bytes[i + 1] as number) & 0x3f);
                    i += 2;
                } else if ((byte & 0xf0) === 0xe0) {
                    code = ((byte & 0x0f) << 12) | (((bytes[i + 1] as number) & 0x3f) << 6) | ((bytes[i + 2] as number) & 0x3f);
                    i += 3;
                } else {
                    code =
                        ((byte & 0x07) << 18) |
                        (((bytes[i + 1] as number) & 0x3f) << 12) |
                        (((bytes[i + 2] as number) & 0x3f) << 6) |
                        ((bytes[i + 3] as number) & 0x3f);
                    i += 4;
                }

                if (code <= 0xffff) {
                    result += String.fromCharCode(code);
                } else {
                    // Surrogate pair
                    code -= 0x10000;
                    result += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
                }
            }
            return result;
        }
    } as unknown as typeof TextDecoder;
}

// Map (for extremely old environments)
if (typeof globalThis.Map === 'undefined') {
    globalThis.Map = class Map<K, V> {
        readonly #entries: Array<[K, V]> = [];

        constructor(entries?: Iterable<[K, V]> | null) {
            if (entries) {
                for (const [k, v] of entries) {
                    this.set(k, v);
                }
            }
        }

        get size(): number {
            return this.#entries.length;
        }

        has(key: K): boolean {
            return this.#entries.some(([k]) => k === key);
        }

        get(key: K): V | undefined {
            const entry = this.#entries.find(([k]) => k === key);
            return entry?.[1];
        }

        set(key: K, value: V): this {
            const idx = this.#entries.findIndex(([k]) => k === key);
            if (idx >= 0) {
                this.#entries[idx] = [key, value];
            } else {
                this.#entries.push([key, value]);
            }
            return this;
        }

        delete(key: K): boolean {
            const idx = this.#entries.findIndex(([k]) => k === key);
            if (idx >= 0) {
                this.#entries.splice(idx, 1);
                return true;
            }
            return false;
        }

        clear(): void {
            this.#entries.length = 0;
        }

        forEach(cb: (value: V, key: K, map: Map<K, V>) => void): void {
            for (const [k, v] of this.#entries) {
                cb(v, k, this);
            }
        }

        keys(): IterableIterator<K> {
            return this.#entries.map(([k]) => k)[Symbol.iterator]() as IterableIterator<K>;
        }

        values(): IterableIterator<V> {
            return this.#entries.map(([, v]) => v)[Symbol.iterator]() as IterableIterator<V>;
        }

        entries(): IterableIterator<[K, V]> {
            return this.#entries[Symbol.iterator]() as IterableIterator<[K, V]>;
        }

        [Symbol.iterator](): IterableIterator<[K, V]> {
            return this.entries();
        }

        get [Symbol.toStringTag](): string {
            return 'Map';
        }
    } as unknown as MapConstructor;
}

// Promise.allSettled (ES2020)
if (typeof Promise.allSettled !== 'function') {
    Promise.allSettled = function allSettled<T extends readonly unknown[]>(
        promises: T,
    ): Promise<{
        -readonly [K in keyof T]: PromiseSettledResult<Awaited<T[K]>>;
    }> {
        return Promise.all(
            Array.from(promises as Iterable<unknown>, (p) =>
                Promise.resolve(p).then(
                    (value) => ({ status: 'fulfilled' as const, value }),
                    (reason: unknown) => ({ status: 'rejected' as const, reason }),
                ),
            ),
        ) as Promise<{
            -readonly [K in keyof T]: PromiseSettledResult<Awaited<T[K]>>;
        }>;
    };
}

// structuredClone (ES2022 — used for PSBT cloning)
if (typeof globalThis.structuredClone === 'undefined') {
    globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

// Symbol.dispose / Symbol.asyncDispose (ES2024 — Explicit Resource Management)
if (typeof Symbol['dispose'] === 'undefined') {
    (Symbol as unknown as Record<string, symbol>)['dispose'] = Symbol.for('Symbol.dispose');
}
if (typeof Symbol['asyncDispose'] === 'undefined') {
    (Symbol as unknown as Record<string, symbol>)['asyncDispose'] = Symbol.for('Symbol.asyncDispose');
}
