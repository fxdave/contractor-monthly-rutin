import crypto from "node:crypto";

export function passwordHash(password: string): string {
  return crypto.createHash("sha512").update(password).digest("hex").toUpperCase();
}

export function requestSignature(
  requestId: string,
  timestamp14: string,
  signKey: string,
  extraHashes: string[] = []
): string {
  const parts = [requestId, timestamp14, signKey, ...extraHashes];
  return crypto
    .createHash("sha3-512")
    .update(parts.join(""))
    .digest("hex")
    .toUpperCase();
}

export function invoiceHash(operation: string, base64Data: string): string {
  return crypto
    .createHash("sha3-512")
    .update(operation + base64Data)
    .digest("hex")
    .toUpperCase();
}

export function toTimestamp14(date: Date): string {
  return date.toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
}

export function toIsoTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}

export function aesDecrypt(encrypted: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function aesEncrypt(plain: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

export function verifyAesRoundTrip(data: Buffer, key: Buffer): void {
  const encrypted = aesEncrypt(data, key);
  const decrypted = aesDecrypt(encrypted, key);
  if (!decrypted.equals(data)) {
    throw new Error(
      `AES round-trip FAILED: original ${data.length}b, decrypted ${decrypted.length}b`
    );
  }
}
