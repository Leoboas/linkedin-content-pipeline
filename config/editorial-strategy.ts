import type { EditorialPillar, FormatType } from "@prisma/client";

export const EDITORIAL_STRATEGY = {
  cadence: {
    postsPerWeek: 4,
    weekdays: [1, 2, 4, 5],
    timezone: "America/Sao_Paulo",
    maxApprovalCards: 3,
    supportedFormats: ["TEXT_ONLY", "SINGLE_IMAGE", "CAROUSEL_PDF"] as const,
    unsupportedFormats: ["MOTION"] as const,
  },
  markets: ["Brasil", "LATAM", "Internacional"],
  languages: ["pt-BR", "en-US"],
  targetRoles: [
    "Python Engineer",
    "Python Backend Engineer",
    "Data Engineer",
    "Backend Engineer",
    "Software Engineer",
    "Data Platform Engineer",
    "Tech Lead",
  ],
  pillars: {
    TOFU: {
      audience: "engenheiros, líderes técnicos e recrutadores conhecendo o problema",
      themes: ["Python", "Backend", "cloud", "decisões práticas de engenharia"],
      formats: ["CAROUSEL_PDF", "SINGLE_IMAGE", "TEXT_ONLY"] as FormatType[],
    },
    MOFU: {
      audience: "profissionais avaliando abordagem, trade-offs e arquitetura",
      themes: ["AWS", "APIs", "bancos de dados", "observabilidade", "data pipelines"],
      formats: ["SINGLE_IMAGE", "CAROUSEL_PDF", "TEXT_ONLY"] as FormatType[],
    },
    BOFU: {
      audience: "gestores técnicos, pares seniores e recrutadores com demanda concreta",
      themes: ["Data Engineering", "System Design", "ETL/ELT", "arquitetura", "liderança próxima do código"],
      formats: ["CAROUSEL_PDF", "SINGLE_IMAGE", "TEXT_ONLY"] as FormatType[],
    },
  } satisfies Record<EditorialPillar, { audience: string; themes: string[]; formats: FormatType[] }>,
} as const;

export function editorialStrategyPrompt(): string {
  return [
    `Cadência: ${EDITORIAL_STRATEGY.cadence.postsPerWeek} slots por semana (${EDITORIAL_STRATEGY.cadence.weekdays.join(", ")} em ${EDITORIAL_STRATEGY.cadence.timezone}), no máximo ${EDITORIAL_STRATEGY.cadence.maxApprovalCards} cards aguardando aprovação simultaneamente.`,
    "Rotação de formato: texto para decisões curtas, imagem única para conceito/gancho e carrossel PDF para arquitetura, fluxos ou comparação; Motion permanece planejado, mas não deve ser gerado até validar compatibilidade de upload/publicação.",
    "Distribuição editorial: aproximadamente 45% Software/Backend, 35% Data/Cloud e 20% Arquitetura/Tech Leadership.",
    "Fontes prioritárias: Unilever, Crecido, V4, SerenaERP, NASA ETL, DriveSense e experiências verificadas. Nunca invente resultado, métrica ou funcionalidade.",
    "Alterne português do Brasil e inglês técnico conforme a qualidade do tema; comece com 2 a 3 posts em inglês por semana quando houver contexto suficiente, sem misturar idiomas no mesmo post.",
    "PLANEJAMENTO EDITORIAL:",
    `Mercados: ${EDITORIAL_STRATEGY.markets.join(", ")}. Idiomas permitidos: ${EDITORIAL_STRATEGY.languages.join(", ")}.`,
    `Cargos prioritários: ${EDITORIAL_STRATEGY.targetRoles.join(", ")}.`,
    ...Object.entries(EDITORIAL_STRATEGY.pillars).map(([pillar, plan]) =>
      `${pillar}: público=${plan.audience}; temas=${plan.themes.join(", ")}; formatos=${plan.formats.join(", ")}.`),
  ].join("\n");
}
