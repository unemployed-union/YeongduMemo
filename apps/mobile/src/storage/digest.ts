import * as Crypto from 'expo-crypto';

export async function attachmentDigest(bytes: Uint8Array): Promise<string> {
  const hash = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
