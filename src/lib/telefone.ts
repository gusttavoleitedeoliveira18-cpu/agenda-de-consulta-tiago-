import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

// Validação internacional com os metadados completos do libphonenumber (Google),
// nunca com expressões regulares próprias. Fonte de verdade: E.164.

export type TelefoneValidado =
  | { ok: true; e164: string; pais: CountryCode | undefined; internacional: string }
  | { ok: false; erro: "vazio" | "invalido" | "pais" };

export function validarTelefone(valor: string, paisInformado?: string): TelefoneValidado {
  const bruto = (valor ?? "").trim();
  if (!bruto) return { ok: false, erro: "vazio" };
  if (!bruto.startsWith("+")) return { ok: false, erro: "pais" };
  const n = parsePhoneNumberFromString(bruto);
  if (!n || !n.isValid()) return { ok: false, erro: "invalido" };
  const pais = n.country ?? (paisInformado as CountryCode | undefined);
  return { ok: true, e164: n.number, pais, internacional: n.formatInternational() };
}

/** Exibição legível de um número E.164 (ex.: +55 71 99999-9999). */
export function formatarTelefone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const n = parsePhoneNumberFromString(e164);
  return n ? n.formatInternational() : e164;
}

/**
 * Link wa.me a partir do E.164: remove "+" e formatação, preserva o código do país.
 * Retorna null para valores inválidos — nunca gera link fictício.
 */
export function linkWhatsApp(e164OuDigitos: string | null | undefined, texto?: string): string | null {
  if (!e164OuDigitos) return null;
  const comMais = e164OuDigitos.startsWith("+") ? e164OuDigitos : `+${e164OuDigitos.replace(/\D/g, "")}`;
  const n = parsePhoneNumberFromString(comMais);
  if (!n || !n.isValid()) return null;
  const digitos = n.number.replace(/\D/g, "");
  return `https://wa.me/${digitos}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}
