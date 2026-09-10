export const CONTENT_FRAMEWORKS = {
  dataStorytelling: "Estrutura: Situação/Desafio técnico -> Decisão de arquitetura -> Resultado numérico/Métrica -> Lição de engenharia.",
  technicalCopywriting: "Hook de 2 linhas chamativo (sem clickbait) -> Parágrafos curtos (máx 2 frases) -> Ritmo confortável e escaneável no mobile.",
  thoughtLeadership: "Posicionamento técnico fundamentado -> Questionamento de consensos de mercado -> Foco em ROI, estabilidade e escala.",
  executiveCommunication: "Comunicação clara de senioridade, liderança, governança de dados e impacto direto no negócio.",
} as const;

export const CONTENT_SKILLS = [
  "Technical Writing",
  "Content Strategy",
  "Content Marketing",
  "Copywriting",
  "Thought Leadership",
  "Executive Communication",
  "Data-Driven Decision Making",
] as const;

export function contentFrameworkPrompt(): string {
  return Object.entries(CONTENT_FRAMEWORKS)
    .map(([name, guidance]) => `${name}: ${guidance}`)
    .join("\n");
}
