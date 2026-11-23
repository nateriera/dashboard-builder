// Protected HTML export (§6): password envelope, shared by the composer
// (encryption at export) and the viewer (decryption at unlock). No DOM
// access, so this module is directly unit-testable in node (Node 24 has
// WebCrypto). The password itself is never stored or logged here — it only
// exists as a function argument for the duration of one call, and callers
// must clear their copy after use.

export const ENVELOPE_VERSION = 6;
export const KDF_ITERATIONS = 600_000;
export const AAD = "dashboard-builder:v6";
export const MIN_PASSWORD_LENGTH = 12;

// Standard base64 (not base64url), chunked so multi-megabyte payloads
// don't build one giant intermediate string.
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

function subtle() {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Password protection needs WebCrypto, which this browser does not provide.");
  }
  return crypto.subtle;
}

async function deriveKey(password, salt, iterations) {
  const base = await subtle().importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

/** Validate a password + confirmation. Returns an error string, or null
 *  when the password is acceptable. */
export function validatePassword(password, confirm) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

/** Encrypt a JSON string into the v6 envelope (§6.3). The whole payload is
 *  encrypted; only the envelope metadata stays in plaintext. `aad` is an
 *  override for tests — production callers use the module constant. */
export async function encryptPayload(jsonString, password, aad = AAD) {
  if (typeof jsonString !== "string") throw new Error("Nothing to encrypt.");
  const problem = validatePassword(password, password);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const data = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key, new TextEncoder().encode(jsonString)
  );
  return {
    app: "dashboard-builder",
    version: ENVELOPE_VERSION,
    kind: "dashboard-export",
    encrypted: true,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: bufToB64(salt) },
    cipher: { name: "AES-GCM", iv: bufToB64(iv) },
    data: bufToB64(data)
  };
}

/** Decrypt a v6 envelope back to its JSON string. Throws on any failure —
 *  wrong password, tampered data, wrong AAD, or a malformed envelope.
 *  Callers must map every failure to the same generic message (§6.4). */
export async function decryptPayload(envelope, password, aad = AAD) {
  if (!isEncryptedPayload(envelope)) throw new Error("Not a protected export.");
  const iterations = envelope.kdf?.iterations;
  if (!Number.isInteger(iterations) || iterations <= 0) throw new Error("Invalid protected export.");
  const key = await deriveKey(password, b64ToBuf(envelope.kdf.salt), iterations);
  const plaintext = await subtle().decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(envelope.cipher.iv)), additionalData: new TextEncoder().encode(aad) },
    key, b64ToBuf(envelope.data)
  );
  return new TextDecoder().decode(plaintext);
}

/** True when parsed JSON is a protected-export envelope (not a plaintext
 *  payload). Plaintext v1/v5 exports return false and open as before. */
export function isEncryptedPayload(parsed) {
  return !!parsed && parsed.encrypted === true && typeof parsed.data === "string";
}
