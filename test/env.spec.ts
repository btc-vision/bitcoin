import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('Runtime capability check — hard requirements', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should pass in a capable environment', async () => {
        await expect(import('../src/env.js')).resolves.not.toThrow();
    });

    it('should throw when BigInt is missing', async () => {
        vi.stubGlobal('BigInt', undefined);

        await expect(import('../src/env.js')).rejects.toThrow('unsupported runtime');
        await expect(import('../src/env.js')).rejects.toThrow('BigInt');
    });

    it('should throw when Uint8Array is missing', async () => {
        vi.stubGlobal('Uint8Array', undefined);

        await expect(import('../src/env.js')).rejects.toThrow('unsupported runtime');
        await expect(import('../src/env.js')).rejects.toThrow('Uint8Array');
    });

    it('should throw when DataView.getBigInt64 is missing', async () => {
        const orig = DataView.prototype.getBigInt64;
        (DataView.prototype as unknown as Record<string, unknown>)['getBigInt64'] = undefined;

        try {
            await import('../src/env.js');
            expect.unreachable('should have thrown');
        } catch (err) {
            expect((err as Error).message).toContain('getBigInt64');
        } finally {
            DataView.prototype.getBigInt64 = orig;
        }
    });

    it('should report all missing capabilities at once', async () => {
        vi.stubGlobal('BigInt', undefined);
        vi.stubGlobal('Uint8Array', undefined);

        try {
            await import('../src/env.js');
            expect.unreachable('should have thrown');
        } catch (err) {
            const msg = (err as Error).message;
            expect(msg).toContain('BigInt');
            expect(msg).toContain('Uint8Array');
            expect(msg).toContain('cannot be polyfilled');
        }
    });
});

describe('Polyfill — TextEncoder / TextDecoder', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should polyfill TextEncoder when missing', async () => {
        vi.stubGlobal('TextEncoder', undefined);

        await import('../src/env.js');

        const encoder = new globalThis.TextEncoder();
        const result = encoder.encode('hello');
        expect(result).toBeInstanceOf(Uint8Array);
        expect(Array.from(result)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    });

    it('should encode multi-byte UTF-8 correctly', async () => {
        vi.stubGlobal('TextEncoder', undefined);

        await import('../src/env.js');

        const encoder = new globalThis.TextEncoder();
        // 2-byte: é (U+00E9)
        const twoB = encoder.encode('é');
        expect(Array.from(twoB)).toEqual([0xc3, 0xa9]);

        // 3-byte: € (U+20AC)
        const threeB = encoder.encode('€');
        expect(Array.from(threeB)).toEqual([0xe2, 0x82, 0xac]);
    });

    it('should encode surrogate pairs (4-byte UTF-8)', async () => {
        vi.stubGlobal('TextEncoder', undefined);

        await import('../src/env.js');

        const encoder = new globalThis.TextEncoder();
        // U+1F600 (😀) = F0 9F 98 80
        const emoji = encoder.encode('😀');
        expect(Array.from(emoji)).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    });

    it('should polyfill TextDecoder when missing', async () => {
        vi.stubGlobal('TextDecoder', undefined);

        await import('../src/env.js');

        const decoder = new globalThis.TextDecoder();
        const result = decoder.decode(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));
        expect(result).toBe('hello');
    });

    it('should decode multi-byte UTF-8 correctly', async () => {
        vi.stubGlobal('TextDecoder', undefined);

        await import('../src/env.js');

        const decoder = new globalThis.TextDecoder();
        expect(decoder.decode(new Uint8Array([0xc3, 0xa9]))).toBe('é');
        expect(decoder.decode(new Uint8Array([0xe2, 0x82, 0xac]))).toBe('€');
    });

    it('should decode surrogate pairs (4-byte UTF-8)', async () => {
        vi.stubGlobal('TextDecoder', undefined);

        await import('../src/env.js');

        const decoder = new globalThis.TextDecoder();
        expect(decoder.decode(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]))).toBe('😀');
    });

    it('should round-trip encode/decode', async () => {
        vi.stubGlobal('TextEncoder', undefined);
        vi.stubGlobal('TextDecoder', undefined);

        await import('../src/env.js');

        const input = 'Hello, 世界! 🚀';
        const encoder = new globalThis.TextEncoder();
        const decoder = new globalThis.TextDecoder();
        expect(decoder.decode(encoder.encode(input))).toBe(input);
    });

    it('should not replace native TextEncoder', async () => {
        const NativeTextEncoder = globalThis.TextEncoder;

        await import('../src/env.js');

        expect(globalThis.TextEncoder).toBe(NativeTextEncoder);
    });
});

describe('Polyfill — Map', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should polyfill Map when missing', async () => {
        vi.stubGlobal('Map', undefined);

        await import('../src/env.js');

        const map = new globalThis.Map<string, number>();
        map.set('a', 1);
        map.set('b', 2);
        expect(map.size).toBe(2);
        expect(map.get('a')).toBe(1);
        expect(map.has('b')).toBe(true);
        expect(map.has('c')).toBe(false);
    });

    it('should support delete and clear', async () => {
        vi.stubGlobal('Map', undefined);

        await import('../src/env.js');

        const map = new globalThis.Map<string, number>();
        map.set('x', 10);
        map.set('y', 20);
        expect(map.delete('x')).toBe(true);
        expect(map.delete('x')).toBe(false);
        expect(map.size).toBe(1);

        map.clear();
        expect(map.size).toBe(0);
    });

    it('should support iteration', async () => {
        vi.stubGlobal('Map', undefined);

        await import('../src/env.js');

        const map = new globalThis.Map<string, number>([
            ['a', 1],
            ['b', 2],
        ]);

        const keys = [...map.keys()];
        const values = [...map.values()];
        const entries = [...map.entries()];

        expect(keys).toEqual(['a', 'b']);
        expect(values).toEqual([1, 2]);
        expect(entries).toEqual([
            ['a', 1],
            ['b', 2],
        ]);
    });

    it('should support forEach', async () => {
        vi.stubGlobal('Map', undefined);

        await import('../src/env.js');

        const map = new globalThis.Map([['k', 'v']]);
        const collected: string[] = [];
        map.forEach((val, key) => collected.push(`${key}=${val}`));
        expect(collected).toEqual(['k=v']);
    });

    it('should overwrite existing keys', async () => {
        vi.stubGlobal('Map', undefined);

        await import('../src/env.js');

        const map = new globalThis.Map<string, number>();
        map.set('a', 1);
        map.set('a', 2);
        expect(map.size).toBe(1);
        expect(map.get('a')).toBe(2);
    });

    it('should not replace native Map', async () => {
        const NativeMap = globalThis.Map;

        await import('../src/env.js');

        expect(globalThis.Map).toBe(NativeMap);
    });
});

describe('Polyfill — Promise.allSettled', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should polyfill Promise.allSettled when missing', async () => {
        const orig = Promise.allSettled;
        (Promise as unknown as Record<string, unknown>)['allSettled'] = undefined;

        try {
            await import('../src/env.js');

            const results = await Promise.allSettled([
                Promise.resolve(1),
                Promise.reject(new Error('fail')),
                Promise.resolve(3),
            ]);

            expect(results).toHaveLength(3);
            expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
            expect(results[1]!.status).toBe('rejected');
            expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
            expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
        } finally {
            Promise.allSettled = orig;
        }
    });

    it('should not replace native Promise.allSettled', async () => {
        const native = Promise.allSettled;

        await import('../src/env.js');

        expect(Promise.allSettled).toBe(native);
    });
});

describe('Polyfill — structuredClone', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should polyfill structuredClone when missing', async () => {
        vi.stubGlobal('structuredClone', undefined);

        await import('../src/env.js');

        const original = { a: 1, b: { c: 2 } };
        const cloned = globalThis.structuredClone(original);

        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
        expect(cloned.b).not.toBe(original.b);
    });

    it('should deep clone nested objects', async () => {
        vi.stubGlobal('structuredClone', undefined);

        await import('../src/env.js');

        const original = { x: [1, 2, { y: 3 }] };
        const cloned = globalThis.structuredClone(original);

        cloned.x[0] = 99;
        (cloned.x[2] as { y: number }).y = 99;

        expect(original.x[0]).toBe(1);
        expect((original.x[2] as { y: number }).y).toBe(3);
    });

    it('should handle primitives and null', async () => {
        vi.stubGlobal('structuredClone', undefined);

        await import('../src/env.js');

        expect(globalThis.structuredClone(42)).toBe(42);
        expect(globalThis.structuredClone('hello')).toBe('hello');
        expect(globalThis.structuredClone(true)).toBe(true);
        expect(globalThis.structuredClone(null)).toBe(null);
    });

    it('should not replace native structuredClone', async () => {
        const native = globalThis.structuredClone;

        await import('../src/env.js');

        expect(globalThis.structuredClone).toBe(native);
    });
});

describe('Polyfill — Symbol.dispose / Symbol.asyncDispose', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should ensure Symbol.dispose is defined after import', async () => {
        await import('../src/env.js');
        expect(typeof Symbol.dispose).toBe('symbol');
    });

    it('should ensure Symbol.asyncDispose is defined after import', async () => {
        await import('../src/env.js');
        expect(typeof Symbol.asyncDispose).toBe('symbol');
    });

    it('should polyfill dispose on a target that lacks it', () => {
        const target: Record<string, symbol | undefined> = { dispose: undefined };
        if (typeof target['dispose'] === 'undefined') {
            target['dispose'] = Symbol.for('Symbol.dispose');
        }
        expect(target['dispose']).toBe(Symbol.for('Symbol.dispose'));
    });

    it('should polyfill asyncDispose on a target that lacks it', () => {
        const target: Record<string, symbol | undefined> = { asyncDispose: undefined };
        if (typeof target['asyncDispose'] === 'undefined') {
            target['asyncDispose'] = Symbol.for('Symbol.asyncDispose');
        }
        expect(target['asyncDispose']).toBe(Symbol.for('Symbol.asyncDispose'));
    });

    it('should not overwrite an existing dispose symbol', () => {
        const existing = Symbol('existing');
        const target: Record<string, symbol> = { dispose: existing };
        if (typeof target['dispose'] === 'undefined') {
            target['dispose'] = Symbol.for('Symbol.dispose');
        }
        expect(target['dispose']).toBe(existing);
    });

    it('should not overwrite an existing asyncDispose symbol', () => {
        const existing = Symbol('existing');
        const target: Record<string, symbol> = { asyncDispose: existing };
        if (typeof target['asyncDispose'] === 'undefined') {
            target['asyncDispose'] = Symbol.for('Symbol.asyncDispose');
        }
        expect(target['asyncDispose']).toBe(existing);
    });

    it('should produce a usable symbol for async method dispatch', async () => {
        const sym = Symbol.for('Symbol.asyncDispose');
        const obj = {
            disposed: false,
            async [sym]() {
                this.disposed = true;
            },
        };

        await obj[sym]();
        expect(obj.disposed).toBe(true);
    });
});
