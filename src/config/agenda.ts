// Configurações OPERACIONAIS da agenda (não são segredos e não contêm textos de apresentação).
// Os textos institucionais dos serviços continuam em src/config/site.ts.
//
// ⚠️ PENDÊNCIAS DO PROPRIETÁRIO — nenhum valor abaixo foi inventado:
//   * duracaoMinutos de cada serviço está null. Enquanto estiver null, o serviço
//     NÃO aceita solicitações (o formulário mostra "agendamento em breve").
//   * bufferMinutos = 0 significa "sem intervalo extra" até o proprietário definir.
//   * horarioFuncionamento = null: o sistema não afirma disponibilidade de agenda;
//     cada envio é uma SOLICITAÇÃO sujeita à análise do profissional.
//   * prazos de 48 h são valores iniciais sugeridos, sujeitos a validação.
//   * O fuso é definido pela variável PROFESSIONAL_TIME_ZONE (padrão sugerido: America/Bahia).

export type CodigoServico = "consultoria_online" | "acompanhamento_presencial" | "aula_futebol" | "nao_sei";

export type ServicoOperacional = {
  /** Duração do atendimento em minutos. null = não configurada (não aceita reservas). */
  duracaoMinutos: number | null;
  /** Intervalo de preparação/descanso após o atendimento, em minutos. */
  bufferMinutos: number;
  /** Permite desativar temporariamente um serviço sem removê-lo do site. */
  ativo: boolean;
};

export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = segunda ... 7 = domingo (ISO)
/** Faixas "HH:MM"-"HH:MM" no fuso do profissional. O atendimento inteiro deve caber na faixa. */
export type HorarioFuncionamento = Partial<Record<DiaSemana, Array<[string, string]>>>;

export const agenda = {
  servicos: {
    consultoria_online: { duracaoMinutos: null, bufferMinutos: 0, ativo: true },
    acompanhamento_presencial: { duracaoMinutos: null, bufferMinutos: 0, ativo: true },
    aula_futebol: { duracaoMinutos: null, bufferMinutos: 0, ativo: true },
    nao_sei: { duracaoMinutos: null, bufferMinutos: 0, ativo: true },
  } satisfies Record<CodigoServico, ServicoOperacional> as Record<CodigoServico, ServicoOperacional>,

  /** null = ainda não informado pelo proprietário (não há validação de dias/horários). */
  horarioFuncionamento: null as HorarioFuncionamento | null,

  /** Prazo para o profissional analisar uma solicitação pendente (valor inicial sugerido). */
  prazoPendenteHoras: 48,
  /** Validade da proposta de novo horário / token enviado ao aluno (valor inicial sugerido). */
  prazoPropostaHoras: 48,

  privacidade: {
    /** Atualize sempre que o texto de /privacidade mudar. */
    versao: "2026-11-17",
    /** Tipo de manifestação registrada no envio do formulário. */
    manifestacao: "ciencia_aviso_privacidade",
    /** Base legal documentada para a finalidade "tratar a solicitação de atendimento"
     *  (LGPD art. 7º, V — procedimentos preliminares relacionados a contrato, a pedido do titular).
     *  Sujeita à validação do controlador. */
    baseLegal: "procedimentos_preliminares_contrato",
  },
} as const;
