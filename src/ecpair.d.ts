/**
 * Ambient module declaration for ecpair.
 *
 * The upstream ecpair@3 .d.ts files depend on valibot@^0.37 type-level APIs.
 * When a different valibot major is hoisted (e.g. v1.x required by bip32),
 * @typescript-eslint resolves valibot from the project root instead of
 * ecpair's nested node_modules, turning every ecpair type into an error type.
 *
 * This local declaration re-exports the subset of ecpair's public API that
 * this project actually uses, without any valibot dependency.
 */
declare module '@btc-vision/ecpair' {
    interface Network {
        messagePrefix: string | Uint8Array;
        bech32: string;
        bip32: {
            public: number;
            private: number;
        };
        pubKeyHash: number;
        scriptHash: number;
        wif: number;
    }

    interface Signer {
        publicKey: Uint8Array;
        network?: unknown;
        sign(hash: Uint8Array, lowR?: boolean): Uint8Array;
    }

    interface SignerAsync {
        publicKey: Uint8Array;
        network?: unknown;
        sign(hash: Uint8Array, lowR?: boolean): Promise<Uint8Array>;
    }

    interface ECPairInterface extends Signer {
        compressed: boolean;
        network: Network;
        lowR: boolean;
        privateKey?: Uint8Array;
        toWIF(): string;
        tweak(t: Uint8Array): ECPairInterface;
        verify(hash: Uint8Array, signature: Uint8Array): boolean;
        verifySchnorr(hash: Uint8Array, signature: Uint8Array): boolean;
        signSchnorr(hash: Uint8Array): Uint8Array;
    }

    interface ECPairOptions {
        compressed?: boolean;
        network?: Network;
        rng?: (arg?: number) => Uint8Array;
    }

    interface ECPairAPI {
        isPoint(maybePoint: unknown): boolean;
        fromPrivateKey(buffer: Uint8Array, options?: ECPairOptions): ECPairInterface;
        fromPublicKey(buffer: Uint8Array, options?: ECPairOptions): ECPairInterface;
        fromWIF(wifString: string, network?: Network | Network[]): ECPairInterface;
        makeRandom(options?: ECPairOptions): ECPairInterface;
    }

    interface TinySecp256k1Interface {
        isPoint(p: Uint8Array): boolean;
        pointCompress(p: Uint8Array, compressed?: boolean): Uint8Array;
        isPrivate(d: Uint8Array): boolean;
        pointFromScalar(d: Uint8Array, compressed?: boolean): Uint8Array | null;
        xOnlyPointAddTweak(
            p: Uint8Array,
            tweak: Uint8Array,
        ): { parity: 1 | 0; xOnlyPubkey: Uint8Array } | null;
        privateAdd(d: Uint8Array, tweak: Uint8Array): Uint8Array | null;
        privateNegate(d: Uint8Array): Uint8Array;
        sign(h: Uint8Array, d: Uint8Array, e?: Uint8Array): Uint8Array;
        signSchnorr?(h: Uint8Array, d: Uint8Array, e?: Uint8Array): Uint8Array;
        verify(h: Uint8Array, Q: Uint8Array, signature: Uint8Array, strict?: boolean): boolean;
        verifySchnorr?(h: Uint8Array, Q: Uint8Array, signature: Uint8Array): boolean;
    }

    const networks: {
        bitcoin: Network;
        testnet: Network;
    };

    function ECPairFactory(ecc: TinySecp256k1Interface): ECPairAPI;
    export default ECPairFactory;

    export {
        ECPairFactory,
        Signer,
        SignerAsync,
        ECPairAPI,
        ECPairInterface,
        ECPairOptions,
        TinySecp256k1Interface,
        Network,
        networks,
    };
}
