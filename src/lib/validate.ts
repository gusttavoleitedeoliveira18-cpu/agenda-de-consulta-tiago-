import * as z from "zod/mini";
import { site } from "@/config/site";

// Schema compartilhado entre o formulário (feedback imediato) e o servidor (validação definitiva).
// O servidor SEMPRE revalida tudo, inclusive telefone com metadados completos, fuso e disponibilidade.

export const LIMITES = { nome: 120, email: 160, objetivo: 600 } as const;

export const CAMPOS = [
  "nome", "email", "whatsapp", "tipo_atendimento", "data_solicitada", "horario_solicitado", "objetivo", "privacidade",
] as const;
export type Campo = (typeof CAMPOS)[number];
export type Erros = Partial<Record<Campo | "whatsapp_pais", string>>;

export const solicitacaoSchema = z.object({
  nome: z.string().check(z.trim(), z.minLength(3, "Informe seu nome completo."), z.maxLength(LIMITES.nome, "Use até 120 caracteres."),
    z.refine((s) => /\S+\s+\S+/.test(s), "Informe nome e sobrenome.")),
  email: z.string().check(z.trim(), z.toLowerCase(), z.maxLength(LIMITES.email, "E-mail muito longo."),
    z.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Informe um e-mail válido.")),
  whatsapp: z.string().check(z.trim(), z.minLength(1, "Informe seu WhatsApp."), z.maxLength(20, "Número muito longo.")),
  whatsapp_pais: z.string().check(z.regex(/^([A-Z]{2})?$/, "Selecione o país do WhatsApp.")),
  tipo_atendimento: z.string().check(z.refine((v) => site.tipos.some((t) => t.v === v), "Escolha um tipo de atendimento.")),
  data_solicitada: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data desejada.")),
  horario_solicitado: z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe o horário desejado.")),
  objetivo: z.string().check(z.trim(), z.maxLength(LIMITES.objetivo, "Use até 600 caracteres.")),
  privacidade: z.literal("ciente", "Confirme que leu o Aviso de Privacidade."),
});

export type Solicitacao = z.infer<typeof solicitacaoSchema>;

export type OpcoesValidacao = {
  /** Data de hoje (YYYY-MM-DD) no fuso do profissional. */
  hoje: string;
  /** Códigos de serviço que aceitam solicitações (duração configurada e ativos). */
  servicosDisponiveis: readonly string[];
  /** Validador do telefone (o cliente usa metadados reduzidos; o servidor, os completos). */
  telefoneValido: (e164: string) => boolean;
};

export function validate(entrada: Record<string, unknown>, o: OpcoesValidacao) {
  const bruto = Object.fromEntries(CAMPOS.concat().map((k) => [k, typeof entrada[k] === "string" ? entrada[k] : ""]));
  bruto.whatsapp_pais = typeof entrada.whatsapp_pais === "string" ? entrada.whatsapp_pais : "";
  const r = solicitacaoSchema.safeParse(bruto);
  const e: Erros = {};
  if (!r.success) {
    for (const issue of r.error.issues) {
      const k = issue.path[0] as Campo;
      if (k && !e[k]) e[k] = issue.message;
    }
  }
  const v = r.success ? r.data : undefined;
  const tel = String(bruto.whatsapp ?? "");
  if (!e.whatsapp && tel && !tel.startsWith("+")) e.whatsapp = "Selecione o país e informe o número.";
  else if (!e.whatsapp && tel && !o.telefoneValido(tel)) e.whatsapp = "Número de WhatsApp inválido ou incompleto para o país selecionado.";
  const tipo = String(bruto.tipo_atendimento);
  if (!e.tipo_atendimento && !o.servicosDisponiveis.includes(tipo)) {
    e.tipo_atendimento = "O agendamento on-line deste serviço ainda não está disponível.";
  }
  const data = String(bruto.data_solicitada);
  if (!e.data_solicitada && data < o.hoje) e.data_solicitada = "Escolha uma data a partir de hoje.";
  return { v, e, ok: Object.keys(e).length === 0 && !!v };
}
