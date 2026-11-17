import { site } from "@/config/site";
import { formatarDataHora, rotuloFuso } from "@/lib/tempo";
import { formatarTelefone, linkWhatsApp } from "@/lib/telefone";

export type TipoNotificacao =
  | "solicitacao_recebida" | "confirmacao" | "recusa" | "proposta" | "proposta_aceita" | "proposta_recusada"
  | "cancelamento" | "expiracao_solicitacao" | "expiracao_proposta"
  | "admin_nova_solicitacao" | "admin_proposta_aceita" | "admin_proposta_recusada";

export type DadosAgendamento = {
  id: string; protocolo: string; nome: string; email: string; whatsapp: string; tipo_atendimento: string;
  status: string; fuso_horario: string; inicio_solicitado: string | null; inicio_proposto: string | null;
  inicio_confirmado: string | null; reserva_inicio: string | null; duracao_minutos: number | null;
  expira_em: string | null; motivo: string | null; objetivo: string | null;
};

export type Contexto = {
  a: DadosAgendamento;
  nomeServico: string;
  siteUrl: string;
  /** Link com token (somente para "proposta"). Nunca registrado em logs. */
  linkProposta?: string;
};

export type Email = { assunto: string; html: string; texto: string };

const C = { grafite: "#111614", floresta: "#1B2420", marfim: "#F5F7F2", lima: "#B9E747", neblina: "#AAB5AE" };

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function botao(href: string, rotulo: string, secundario = false) {
  const bg = secundario ? C.floresta : C.lima;
  const fg = secundario ? C.marfim : C.grafite;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0"><tr><td style="border-radius:12px;background:${bg}">
<a href="${esc(href)}" style="display:inline-block;padding:14px 24px;font:600 16px/1.2 Arial,Helvetica,sans-serif;color:${fg};text-decoration:none;border-radius:12px">${esc(rotulo)}</a></td></tr></table>`;
}

function linhas(itens: Array<[string, string]>) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${itens
    .map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #dfe5df;color:#5b6660;font-size:14px;width:40%;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #dfe5df;color:${C.grafite};font-size:15px;font-weight:600">${esc(v)}</td></tr>`)
    .join("")}</table>`;
}

function layout(titulo: string, corpo: string, rodapeExtra = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:${C.marfim}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.marfim}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
<tr><td style="background:${C.grafite};padding:20px 24px;color:${C.marfim};font:700 18px Arial,Helvetica,sans-serif">${esc(site.nome.split(" ")[0])}<span style="color:${C.lima}"> Lima</span> <span style="color:${C.neblina};font-weight:400;font-size:13px">· Personal Trainer</span></td></tr>
<tr><td style="padding:24px;color:${C.grafite};font-size:16px;line-height:1.55">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:${C.grafite}">${esc(titulo)}</h1>
${corpo}
</td></tr>
<tr><td style="background:${C.floresta};padding:18px 24px;color:${C.neblina};font-size:13px;line-height:1.5">
<strong style="color:${C.marfim}">${esc(site.nome)}</strong> · ${esc(site.cref)}<br>${rodapeExtra}Este é um e-mail automático sobre uma solicitação feita no site.
</td></tr></table></td></tr></table></body></html>`;
}

function blocoWhatsApp(texto: string) {
  const wa = linkWhatsApp(site.whatsapp, texto);
  return wa ? `<p style="margin:20px 0 4px">Ficou com alguma dúvida? Fale com o profissional:</p>${botao(wa, "Conversar pelo WhatsApp", true)}` : "";
}

const p = (t: string) => `<p style="margin:0 0 12px">${t}</p>`;
const aviso = (t: string) =>
  `<p style="margin:16px 0;padding:12px 14px;border-left:4px solid ${C.lima};background:#f3f7ea;font-size:15px">${t}</p>`;

export function montarEmail(tipo: TipoNotificacao, ctx: Contexto): Email {
  const { a } = ctx;
  const fuso = a.fuso_horario;
  const quando = (iso: string | null) => `${formatarDataHora(iso, fuso)} (${rotuloFuso(fuso)})`;
  const primeiro = a.nome.split(" ")[0];
  const ola = p(`Olá, ${esc(primeiro)}!`);
  const protocolo: [string, string] = ["Protocolo", a.protocolo];
  const servico: [string, string] = ["Atendimento", ctx.nomeServico];
  const novoPedido = botao(`${ctx.siteUrl}/#agendamento`, "Fazer nova solicitação", true);
  const painel = `${ctx.siteUrl}/admin/agendamentos/${a.id}`;

  const T = (assunto: string, titulo: string, corpo: string, texto: string): Email => ({
    assunto, html: layout(titulo, corpo), texto: `${titulo}\n\n${texto}\n\n${site.nome} · ${site.cref}`,
  });

  switch (tipo) {
    case "solicitacao_recebida":
      return T("Recebemos sua solicitação de horário", "Solicitação recebida",
        ola + p("Recebemos sua solicitação. <strong>O horário ainda não está confirmado</strong>: o profissional vai analisar a disponibilidade e você receberá a resposta por e-mail.") +
        linhas([protocolo, servico, ["Horário solicitado", quando(a.inicio_solicitado)]]) +
        aviso("Confira também sua caixa de spam ou lixo eletrônico.") + blocoWhatsApp(`Olá! Enviei a solicitação ${a.protocolo}.`),
        `Recebemos sua solicitação (protocolo ${a.protocolo}). O horário ainda NÃO está confirmado.\nHorário solicitado: ${quando(a.inicio_solicitado)}`);
    case "confirmacao":
    case "proposta_aceita":
      return T("Seu horário está confirmado", "Horário confirmado ✔",
        ola + p("Seu atendimento está <strong>confirmado</strong>.") +
        linhas([protocolo, servico, ["Data e horário", quando(a.inicio_confirmado ?? a.reserva_inicio)]]) +
        blocoWhatsApp(`Olá! Meu horário (${a.protocolo}) foi confirmado.`),
        `Seu atendimento está confirmado.\nProtocolo: ${a.protocolo}\nData e horário: ${quando(a.inicio_confirmado ?? a.reserva_inicio)}`);
    case "recusa":
      return T("Sobre a sua solicitação de horário", "Não foi possível atender neste horário",
        ola + p("Infelizmente o profissional não conseguirá atender a solicitação abaixo.") +
        linhas([protocolo, servico, ["Horário solicitado", quando(a.inicio_solicitado)], ...(a.motivo ? [["Observação", a.motivo] as [string, string]] : [])]) +
        p("Você pode enviar uma nova solicitação com outra data ou horário.") + novoPedido + blocoWhatsApp(`Olá! Sobre a solicitação ${a.protocolo}.`),
        `Não foi possível atender a solicitação ${a.protocolo}.${a.motivo ? `\nObservação: ${a.motivo}` : ""}`);
    case "proposta":
      return T("Proposta de novo horário", "O profissional propôs outro horário",
        ola + p("O horário solicitado não está disponível, mas o profissional propôs uma alternativa:") +
        linhas([protocolo, servico, ["Você solicitou", quando(a.inicio_solicitado)], ["Horário proposto", quando(a.inicio_proposto)],
          ["Responda até", quando(a.expira_em)]]) +
        p("O horário proposto fica reservado para você até o prazo acima. Escolha se aceita ou não:") +
        (ctx.linkProposta ? botao(ctx.linkProposta, "Ver proposta e responder") : "") +
        p('<span style="font-size:13px;color:#5b6660">O link é pessoal e vale para uma única resposta. Não o encaminhe a outras pessoas.</span>') +
        blocoWhatsApp(`Olá! Sobre a proposta de horário ${a.protocolo}.`),
        `O profissional propôs um novo horário: ${quando(a.inicio_proposto)}.\nResponda até ${quando(a.expira_em)}: ${ctx.linkProposta ?? ""}`);
    case "proposta_recusada":
      return T("Registramos sua resposta", "Proposta recusada",
        ola + p("Registramos que você <strong>não aceitou</strong> o horário proposto. A solicitação foi encerrada e o horário, liberado.") +
        linhas([protocolo, servico]) + novoPedido + blocoWhatsApp(`Olá! Recusei a proposta ${a.protocolo}.`),
        `Registramos sua recusa da proposta (protocolo ${a.protocolo}).`);
    case "cancelamento":
      return T("Atendimento cancelado", "Atendimento cancelado",
        ola + p("O atendimento abaixo foi <strong>cancelado</strong>.") +
        linhas([protocolo, servico, ["Horário", quando(a.inicio_confirmado ?? a.inicio_solicitado)], ...(a.motivo ? [["Motivo", a.motivo] as [string, string]] : [])]) +
        novoPedido + blocoWhatsApp(`Olá! Sobre o cancelamento ${a.protocolo}.`),
        `O atendimento ${a.protocolo} foi cancelado.${a.motivo ? `\nMotivo: ${a.motivo}` : ""}`);
    case "expiracao_solicitacao":
      return T("Sua solicitação expirou", "Solicitação expirada",
        ola + p("Sua solicitação não pôde ser analisada dentro do prazo e foi encerrada. O horário não foi confirmado.") +
        linhas([protocolo, servico, ["Horário solicitado", quando(a.inicio_solicitado)]]) + novoPedido + blocoWhatsApp(`Olá! Minha solicitação ${a.protocolo} expirou.`),
        `Sua solicitação ${a.protocolo} expirou sem confirmação.`);
    case "expiracao_proposta":
      return T("A proposta de horário expirou", "Proposta expirada",
        ola + p("O prazo para responder à proposta de novo horário terminou e a reserva foi liberada.") +
        linhas([protocolo, servico, ["Horário proposto", quando(a.inicio_proposto)]]) + novoPedido + blocoWhatsApp(`Olá! A proposta ${a.protocolo} expirou.`),
        `A proposta de horário ${a.protocolo} expirou.`);
    case "admin_nova_solicitacao":
      return T(`Nova solicitação: ${ctx.nomeServico}`, "Nova solicitação de horário",
        p("Uma nova solicitação aguarda sua análise.") +
        linhas([protocolo, ["Aluno", a.nome], servico, ["Horário solicitado", quando(a.inicio_solicitado)], ["WhatsApp", formatarTelefone(a.whatsapp)], ["Prazo de análise", quando(a.expira_em)]]) +
        botao(painel, "Abrir no painel"),
        `Nova solicitação ${a.protocolo} de ${a.nome}: ${quando(a.inicio_solicitado)}.\n${painel}`);
    case "admin_proposta_aceita":
      return T(`Proposta aceita: ${a.nome}`, "O aluno aceitou a proposta",
        linhas([protocolo, ["Aluno", a.nome], servico, ["Horário confirmado", quando(a.inicio_confirmado)]]) + botao(painel, "Abrir no painel"),
        `${a.nome} aceitou a proposta ${a.protocolo}: ${quando(a.inicio_confirmado)}.\n${painel}`);
    case "admin_proposta_recusada":
      return T(`Proposta recusada: ${a.nome}`, "O aluno recusou a proposta",
        linhas([protocolo, ["Aluno", a.nome], servico]) + botao(painel, "Abrir no painel"),
        `${a.nome} recusou a proposta ${a.protocolo}.\n${painel}`);
  }
}
