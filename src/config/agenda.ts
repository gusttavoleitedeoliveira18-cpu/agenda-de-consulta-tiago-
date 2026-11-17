// Configurações OPERACIONAIS da agenda (não são segredos e não contêm textos de apresentação).
// Os textos institucionais dos serviços continuam em src/config/site.ts.
//
// Decisões do proprietário (17/11/2026):
//   * O site apenas registra a SOLICITAÇÃO; como cada atendimento funciona é definido pelo
//     profissional. Para evitar dois pedidos no mesmo horário, cada solicitação ocupa um
//     BLOCO DE 60 MINUTOS na agenda (duracaoMinutos), sem intervalo extra (bufferMinutos = 0).
//     O profissional pode confirmar, recusar ou propor outro horário.
//   * Prazos de 48 h para análise da solicitação e para resposta à proposta.
//   * Fuso: horário de Brasília (PROFESSIONAL_TIME_ZONE=America/Sao_Paulo).
//   * A opção "Ainda não sei" foi retirada do formulário.
//   * horarioFuncionamento = null: sem restrição de dias/horários (aguardando o profissional).

export type CodigoServico = "consultoria_online" | "acompanhamento_presencial" | "aula_futebol";

export type ServicoOperacional = {
  /** Tempo (minutos) que cada solicitação bloqueia na agenda. null = não aceita reservas. */
  duracaoMinutos: number | null;
  /** Intervalo extra após o bloco, em minutos. */
  bufferMinutos: number;
  /** Permite desativar temporariamente um serviço sem removê-lo do site. */
  ativo: boolean;
};

export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = segunda ... 7 = domingo (ISO)
/** Faixas "HH:MM"-"HH:MM" no fuso do profissional. O bloco inteiro deve caber na faixa. */
export type HorarioFuncionamento = Partial<Record<DiaSemana, Array<[string, string]>>>;

export const agenda = {
  servicos: {
    consultoria_online: { duracaoMinutos: 60, bufferMinutos: 0, ativo: true },
    acompanhamento_presencial: { duracaoMinutos: 60, bufferMinutos: 0, ativo: true },
    aula_futebol: { duracaoMinutos: 60, bufferMinutos: 0, ativo: true },
  } satisfies Record<CodigoServico, ServicoOperacional> as Record<CodigoServico, ServicoOperacional>,

  /** null = sem validação de dias/horários (aguardando informação do profissional). */
  horarioFuncionamento: null as HorarioFuncionamento | null,

  /** Prazo para o profissional analisar uma solicitação pendente. */
  prazoPendenteHoras: 48,
  /** Validade da proposta de novo horário / link enviado ao aluno. */
  prazoPropostaHoras: 48,

  privacidade: {
    /** Atualize sempre que o texto de /privacidade mudar. */
    versao: "2026-11-17",
    manifestacao: "ciencia_aviso_privacidade",
    /** LGPD art. 7º, V — procedimentos preliminares relacionados a contrato, a pedido do titular (sujeita à validação do controlador). */
    baseLegal: "procedimentos_preliminares_contrato",
  },
} as const;
