declare module 'react-native-quick-crypto' {
    interface Hash {
        update(data: Uint8Array | string): Hash;
        digest(): Buffer;
    }
    interface QuickCrypto {
        createHash(algorithm: string): Hash;
    }
    const QuickCrypto: QuickCrypto;
    export default QuickCrypto;
}
