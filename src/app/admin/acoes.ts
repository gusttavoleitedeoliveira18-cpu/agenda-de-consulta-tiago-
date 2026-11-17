"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { agenda } from "@/config/agenda";
import { verificarAdmin } from "@/lib/admin/auth";
import { servico } from "@/lib/agenda/servicos";
import { chaveCriptografia, fusoProfissional } from "@/lib/env";
import { cifrar, gerarToken, hashToken, subchave } from "@/lib/seguranca/cripto";
import { dentroDoFuncionamento, localParaInstante } from "@/lib/tempo";
import { FINALIDADE_TOKEN, processarFila } from "@/lib/email/fila";

// Ações administrativas. Cada uma: (1) verifica sessão + autorização no servidor,
// (2) valida a entrada, (3) chama a função atômica do banco com a SESSÃO do admin
// (RLS/eh_admin() verificam de novo), (4) agenda o envio dos e-mails da Outbox.
// O frontend nunca escolhe o novo estado: só a ação.

export type EstadoAcao = { ok?: boolean; erro?: string; msg?: string };

const ERROS: Record<string, string> = {
  conflito: "Este horário conflita com outro agendamento ativo (considerando duração e intervalo).",
  estado_invalido: "A solicitação mudou de estado. Atualize a página.",
  expirado: "A solicitação expirou e o horário foi liberado.",
  horario_passado: "Escolha um horário futuro.",
  duracao_nao_configurada: "A duração deste serviço ainda não foi configurada (src/config/agenda.ts).",
  nao_encontrado: "Registro não encontrado.",
  proposta_inativa: "A proposta não está mais ativa; crie uma nova proposta para enviar um novo link.",
  parametros_invalidos: "Dados inválidos.",
  nao_autorizado: "Sem permissão.",
};
const mensagemErro = (c?: string) => ERROS[c ?? ""] ?? "Não foi possível concluir a ação. Tente novamente.";

const uuid = z.uuid();
const motivo = z.string().trim().max(500).optional();

type Rpc = { ok: boolean; erro?: string };

export type Sucesso = "confirmado" | "recusado" | "cancelado" | "proposta" | "reenvio";

async function executar(nome: string, args: Record<string, unknown>, id: string, sucesso: Sucesso): Promise<EstadoAcao> {
  const ctx = await verificarAdmin();
  if (!ctx.ok) return { erro: "Sessão expirada ou sem permissão. Entre novamente." };
  const { data, error } = await ctx.supabase.rpc(nome, args);
  if (error) return { erro: error.message.includes("nao_autorizado") ? ERROS.nao_autorizado : mensagemErro() };
  const r = data as Rpc;
  if (!r.ok) return { erro: mensagemErro(r.erro) };
  after(() => processarFila({ limite: 10 }).then(() => undefined).catch(() => undefined));
  revalidatePath(`/admin/agendamentos/${id}`);
  revalidatePath("/admin");
  // Redireciona com aviso persistente: o formulário da ação deixa de existir após a mudança de estado.
  redirect(`/admin/agendamentos/${id}?ok=${sucesso}`);
}

export async function confirmar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { erro: ERROS.parametros_invalidos };
  const ctx = await verificarAdmin();
  if (!ctx.ok) return { erro: "Sessão expirada ou sem permissão. Entre novamente." };
  const { data: a } = await ctx.supabase.from("agendamentos").select("tipo_atendimento").eq("id", id.data).maybeSingle();
  if (!a) return { erro: ERROS.nao_encontrado };
  const s = servico(String(a.tipo_atendimento)); // usado apenas para registros legados sem reserva
  return executar("admin_confirmar", { p_id: id.data, p_duracao: s?.duracaoMinutos ?? null, p_buffer: s?.bufferMinutos ?? 0 }, id.data, "confirmado");
}

export async function recusar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const id = uuid.safeParse(fd.get("id"));
  const m = motivo.safeParse(fd.get("motivo") ?? "");
  if (!id.success || !m.success) return { erro: ERROS.parametros_invalidos };
  return executar("admin_recusar", { p_id: id.data, p_motivo: m.data ?? null }, id.data, "recusado");
}

export async function cancelar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const id = uuid.safeParse(fd.get("id"));
  const m = motivo.safeParse(fd.get("motivo") ?? "");
  if (!id.success || !m.success) return { erro: ERROS.parametros_invalidos };
  return executar("admin_cancelar", { p_id: id.data, p_motivo: m.data ?? null }, id.data, "cancelado");
}

export async function propor(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const id = uuid.safeParse(fd.get("id"));
  const m = motivo.safeParse(fd.get("motivo") ?? "");
  if (!id.success || !m.success) return { erro: ERROS.parametros_invalidos };
  const ctx = await verificarAdmin();
  if (!ctx.ok) return { erro: "Sessão expirada ou sem permissão. Entre novamente." };
  const chave = chaveCriptografia();
  if (!chave) return { erro: "TOKEN_ENCRYPTION_KEY não configurada: não é possível gerar o link seguro da proposta." };
  const { data: a } = await ctx.supabase.from("agendamentos").select("tipo_atendimento").eq("id", id.data).maybeSingle();
  if (!a) return { erro: ERROS.nao_encontrado };
  const s = servico(String(a.tipo_atendimento));
  if (!s?.duracaoMinutos) return { erro: ERROS.duracao_nao_configurada };

  const fuso = fusoProfissional();
  const conv = localParaInstante(String(fd.get("data") ?? ""), String(fd.get("hora") ?? ""), fuso);
  if (!conv.ok) return { erro: conv.erro === "formato" ? "Informe data e horário válidos." : "Horário inexistente ou ambíguo no fuso do profissional." };
  if (conv.instante.getTime() <= Date.now()) return { erro: ERROS.horario_passado };
  if (!dentroDoFuncionamento(conv.instante, s.duracaoMinutos + s.bufferMinutos, fuso, agenda.horarioFuncionamento)) {
    return { erro: "Fora dos dias e horários de funcionamento configurados." };
  }

  // Token de 256 bits: o banco guarda só o hash; a fila guarda o token cifrado (AES-256-GCM)
  // até o envio do e-mail, quando o conteúdo cifrado é apagado.
  const token = gerarToken();
  const expira = new Date(Math.min(Date.now() + agenda.prazoPropostaHoras * 3600_000, conv.instante.getTime()));
  const payload = cifrar(token, subchave(chave, FINALIDADE_TOKEN), id.data);
  return executar("admin_propor", {
    p_id: id.data, p_inicio: conv.instante.toISOString(), p_duracao: s.duracaoMinutos, p_buffer: s.bufferMinutos,
    p_token_hash: hashToken(token), p_token_expira: expira.toISOString(), p_payload_cifrado: payload, p_motivo: m.data ?? null,
  }, id.data, "proposta");
}

export async function reprocessar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const id = uuid.safeParse(fd.get("notificacao"));
  const ag = uuid.safeParse(fd.get("id"));
  if (!id.success || !ag.success) return { erro: ERROS.parametros_invalidos };
  return executar("admin_reprocessar_notificacao", { p_notif: id.data }, ag.data, "reenvio");
}
