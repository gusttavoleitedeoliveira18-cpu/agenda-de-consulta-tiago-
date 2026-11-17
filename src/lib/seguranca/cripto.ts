import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// Somente primitivas consolidadas do Node (OpenSSL): randomBytes, SHA-256, HMAC, HKDF, AES-256-GCM.

/** Token de proposta: 256 bits de entropia, codificação URL-safe. */
export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenComFormatoValido(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
}

/** AES-256-GCM: iv(12) | tag(16) | ciphertext, em base64url, com "v1." de versão. */
export function cifrar(texto: string, chave: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function decifrar(payload: string, chave: Buffer, aad: string): string {
  if (!payload.startsWith("v1.")) throw new Error("payload_desconhecido");
  const b = Buffer.from(payload.slice(3), "base64url");
  const d = createDecipheriv("aes-256-gcm", chave, b.subarray(0, 12));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** Subchave derivada (HKDF-SHA256) para uma finalidade específica. */
export function subchave(chave: Buffer, finalidade: string): Buffer {
  return Buffer.from(hkdfSync("sha256", chave, Buffer.alloc(0), Buffer.from(finalidade), 32));
}

/** Pseudonimização (HMAC-SHA256) para chaves de rate limit — o IP nunca é gravado. */
export function pseudonimo(valor: string, chave: Buffer): string {
  return createHmac("sha256", chave).update(valor).digest("base64url").slice(0, 32);
}

export function hashConteudo(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

export function comparacaoSegura(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}
