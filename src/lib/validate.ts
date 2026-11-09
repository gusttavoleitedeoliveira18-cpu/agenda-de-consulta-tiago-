import { site } from "@/config/site";
export function validate(b: Record<string, unknown>) {
  const s = (k: string) => String(b[k] ?? "").trim();
  const v = { nome: s("nome"), email: s("email").toLowerCase(), whatsapp: s("whatsapp").replace(/\D/g, ""), tipo_atendimento: s("tipo_atendimento"), data_solicitada: s("data_solicitada"), horario_solicitado: s("horario_solicitado"), objetivo: s("objetivo") };
  const e: Record<string, string> = {};
  if (v.nome.length < 3 || v.nome.length > 120) e.nome = "Informe seu nome completo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || v.email.length > 160) e.email = "Informe um e-mail válido.";
  if (!/^\d{10,11}$/.test(v.whatsapp)) e.whatsapp = "Informe o WhatsApp com DDD (10 ou 11 números).";
  if (!site.tipos.some((t) => t.v === v.tipo_atendimento)) e.tipo_atendimento = "Escolha um tipo de atendimento.";
  const hoje = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.data_solicitada) || v.data_solicitada < hoje) e.data_solicitada = "Escolha uma data a partir de hoje.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.horario_solicitado)) e.horario_solicitado = "Informe o horário desejado.";
  if (v.objetivo.length > 600) e.objetivo = "Use até 600 caracteres.";
  return { v, e, ok: Object.keys(e).length === 0 };
}
