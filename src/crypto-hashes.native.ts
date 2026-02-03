import QuickCrypto from 'react-native-quick-crypto';

function quickHash(algorithm: string, data: Uint8Array): Uint8Array {
    const buf = QuickCrypto.createHash(algorithm).update(data).digest();
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function sha256(data: Uint8Array): Uint8Array {
    return quickHash('sha256', data);
}

export function sha1(data: Uint8Array): Uint8Array {
    return quickHash('sha1', data);
}

export function ripemd160(data: Uint8Array): Uint8Array {
    return quickHash('ripemd160', data);
}
