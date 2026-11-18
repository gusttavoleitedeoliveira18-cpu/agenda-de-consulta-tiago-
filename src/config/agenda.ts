// Configurações operacionais do formulário (não são segredos).
//
// Decisões do proprietário (18/11/2026):
//   * O site é uma landing page: o aluno preenche o formulário, o pedido é GRAVADO no
//     banco e o aluno o envia ao profissional pelo WhatsApp (mensagem pronta).
//   * Não há painel, login, e-mails nem bloqueio de horário: o profissional combina
//     tudo diretamente com o aluno pelo WhatsApp.
//   * Fuso: horário de Brasília (PROFESSIONAL_TIME_ZONE=America/Sao_Paulo).

export const agenda = {
  privacidade: {
    /** Atualize sempre que o texto de /privacidade mudar. */
    versao: "2026-11-18",
    manifestacao: "ciencia_aviso_privacidade",
    /** LGPD art. 7º, V — procedimentos preliminares relacionados a contrato, a pedido do titular (sujeita à validação do controlador). */
    baseLegal: "procedimentos_preliminares_contrato",
  },
} as const;
