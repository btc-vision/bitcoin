import { BIP32Interface } from 'bip32';
import { ECPairInterface } from 'ecpair';
import { Signer, SignerAlternative, SignerAsync } from '../psbt.js';
export declare function hookSigner(keyPair: Signer | SignerAlternative | SignerAsync | BIP32Interface | ECPairInterface): void;
