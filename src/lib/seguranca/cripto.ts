import "server-only";
import { createHash, createHmac, hkdfSync } from "node:crypto";

// Somente primitivas consolidadas do Node (OpenSSL): SHA-256, HMAC e HKDF.

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
