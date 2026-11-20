import assert from "node:assert/strict";
import { FormatType, PostStatus, QualityGateStatus } from "@prisma/client";
import { buildContentBrief } from "../src/lib/creative-brief.ts";
import { buildImagePrompt } from "../src/lib/image-prompt-engine.ts";
import { getPublicationEligibility } from "../src/lib/publication-eligibility.ts";

const cases = [
  {
    title: "Seu dashboard responde à pergunta certa, mas no horário errado?",
    text: "O problema nem sempre está no cálculo. Está na idade do dado que sustenta a decisão.\n\nAtraso entre evento, processamento e disponibilidade precisa ser medido.",
    pillar: "TOFU" as const,
    evidence: [{ id: "project-data-platform", source: "knowledge://verified-project", kind: "PORTFOLIO_PROJECT" as const, claim: "Pipeline ETL com camadas observáveis.", verified: true }],
  },
  {
    title: "Escalar um pipeline começa pelos contratos",
    text: "Mais capacidade não corrige uma entrada instável. O contrato precisa definir esquema, atraso e responsabilidade.",
    pillar: "MOFU" as const,
    evidence: [{ id: "fact-data-contracts", source: "knowledge://verified-fact", kind: "CONCEPTUAL_KNOWLEDGE" as const, claim: "Contratos de dados são parte da operação.", verified: true }],
  },
  {
    title: "Uma arquitetura de dados precisa explicar a origem do número",
    text: "A linhagem conecta a origem, a transformação e a camada de consumo. Isso torna a decisão auditável.",
    pillar: "BOFU" as const,
    evidence: [{ id: "project-nasa-platform", source: "https://github.com/example/project", kind: "PORTFOLIO_PROJECT" as const, claim: "Camadas Bronze e Gold documentadas.", verified: true }],
  },
];

for (const item of cases) {
  const brief = buildContentBrief({ title: item.title, textContent: item.text, editorialPillar: item.pillar, projectEvidence: item.evidence });
  const firstSentence = item.text.split(/[.!?]/u)[0]?.trim().toLowerCase();
  assert.ok(brief.thesis.length > 30);
  assert.ok(brief.technicalConflict.length > 20);
  assert.ok(brief.visualConcept.length > 30);
  assert.ok(brief.evidence.length === 1);
  assert.ok(!brief.thesis.toLowerCase().startsWith(item.title.toLowerCase()));
  assert.ok(firstSentence && brief.shortOverlayTitle.length <= 72);

  const prompt = buildImagePrompt({ title: item.title, textContent: item.text, editorialPillar: item.pillar, contentBrief: brief });
  assert.match(prompt, /Technical conflict to visualize/i);
  assert.match(prompt, /do not render words|Negative prompt/i);
  assert.match(prompt, /specific visual concept/i);

  const gateInput = { status: PostStatus.APPROVED, qualityStatus: QualityGateStatus.NEEDS_REVISION, qualityScore: 80, publishedAt: null, formatType: FormatType.SINGLE_IMAGE, mediaUrl: "https://blob.example/creative.png", qualityReview: { renderedImage: { status: "PASS", reviewedMediaUrl: "https://blob.example/creative.png" } }, scheduledDate: new Date(), scheduledFor: new Date() };
  assert.equal(getPublicationEligibility(gateInput).eligible, false);
  assert.equal(getPublicationEligibility({ ...gateInput, qualityStatus: QualityGateStatus.PASS }).eligible, false, "legacy content without a versioned approval must fail closed");
  const exactApproval = { ...gateInput, qualityStatus: QualityGateStatus.PASS, currentVersionId: "version-1", approvedCreativeBriefId: "creative-1", approvedCreativeBrief: { id: "creative-1", postVersionId: "version-1", reviewStatus: QualityGateStatus.PASS, mediaUrl: gateInput.mediaUrl } };
  assert.equal(getPublicationEligibility(exactApproval).eligible, true);
}

console.log(`creative quality acceptance: ${cases.length} casos aprovados; nenhum post foi criado ou publicado.`);
