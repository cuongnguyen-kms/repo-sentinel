/**
 * AES-256-GCM encryption/decryption for GHE token storage.
 * Tokens are encrypted at rest — never stored or returned in plaintext.
 *
 * Format: `<iv_hex>:<authTag_hex>:<encrypted_hex>`
 *
 * Key derivation:
 *   - If ENCRYPTION_KEY is a 64-char hex string, decode with Buffer.from(key, 'hex') → 32 bytes (AES-256)
 *   - Otherwise fall back to legacy UTF-8 slice derivation (key.slice(0, 32))
 *
 * Decrypt supports a migration fallback: if decryption with the current key fails and the key is
 * hex format, it will retry with the legacy UTF-8 derivation to handle data encrypted before migration.
 */

import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/** Pattern for a valid 64-char hex ENCRYPTION_KEY (produces 32-byte AES-256 key). */
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

function isHexKey(key: string): boolean {
  return HEX_KEY_PATTERN.test(key);
}

/** Derive the primary encryption key buffer from ENCRYPTION_KEY env var. */
function getKey(): Buffer {
  const key = process.env["ENCRYPTION_KEY"];
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY env var must be at least 32 characters");
  }
  if (isHexKey(key)) {
    // Preferred: 64-char hex → 32-byte key (true AES-256)
    return Buffer.from(key, "hex");
  }
  // Legacy: treat first 32 UTF-8 chars as the key bytes
  return Buffer.from(key.slice(0, 32), "utf-8");
}

/** Derive the legacy UTF-8 key for migration fallback decryption. */
function getLegacyKey(key: string): Buffer {
  return Buffer.from(key.slice(0, 32), "utf-8");
}

/**
 * Core decrypt helper — decrypts ciphertext with an explicit key buffer.
 * Throws if the ciphertext is malformed or the key/auth-tag is wrong.
 */
function decryptWithKey(ciphertext: string, keyBuf: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format — expected iv:authTag:encrypted");
  }
  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString("utf-8") + decipher.final("utf-8");
}

/** Guard so the hex-key warning fires once per process, not once per encrypt() call. */
let _hexKeyWarningEmitted = false;

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns `iv:authTag:encrypted` — all parts hex-encoded.
 */
export function encrypt(plaintext: string): string {
  const key = process.env["ENCRYPTION_KEY"];
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY env var must be at least 32 characters");
  }
  if (!isHexKey(key) && !_hexKeyWarningEmitted) {
    _hexKeyWarningEmitted = true;
    process.emitWarning(
      "ENCRYPTION_KEY is not a 64-char hex string. " +
      "For true AES-256 security, generate a hex key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      { code: "ENCRYPTION_KEY_FORMAT" }
    );
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a ciphertext string produced by `encrypt`.
 * Throws if the ciphertext is malformed or the key/tag is wrong.
 *
 * Migration fallback: if the current key is hex format but decryption fails,
 * retries with the legacy UTF-8 derivation to handle data encrypted before migration.
 */
export function decrypt(ciphertext: string): string {
  const key = process.env["ENCRYPTION_KEY"];
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY env var must be at least 32 characters");
  }

  const primaryKey = getKey();
  try {
    return decryptWithKey(ciphertext, primaryKey);
  } catch (primaryErr) {
    // If key is hex format, data might have been encrypted with the old UTF-8 derivation
    if (isHexKey(key)) {
      try {
        return decryptWithKey(ciphertext, getLegacyKey(key));
      } catch {
        // Rethrow the original error for clarity
        throw primaryErr;
      }
    }
    throw primaryErr;
  }
}
