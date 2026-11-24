import assert from "node:assert/strict";
import { FormatType, PostStatus, QualityGateStatus } from "@prisma/client";
import { buildContentBrief, normalizeVisualAnchor, toVisualBrief } from "../src/lib/creative-brief.ts";
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
  {
    title: "Quarentena de dados: não descarte eventos que falham no schema",
    text: "No DriveSense Connected Vehicle Platform, eventos originais precisam continuar rastreáveis quando uma validação de schema falha.\n\nA decisão é separar o caminho válido para Silver do caminho inválido para quarentena, preservando o payload. Isso descreve o fluxo do projeto, não uma implantação AWS em produção.",
    pillar: "MOFU" as const,
    evidence: [{ id: "project-drivesense", source: "knowledge://drivesense", kind: "PORTFOLIO_PROJECT" as const, claim: "O projeto de portfólio documenta validação, preservação e quarentena de eventos.", verified: true }],
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

const quarantine = buildContentBrief({ title: cases[3].title, textContent: cases[3].text, editorialPillar: cases[3].pillar, evidence: cases[3].evidence });
assert.deepEqual(quarantine.visualFlow?.nodes, ["Bronze", "Validação", "Silver", "Quarentena"]);
assert.deepEqual(quarantine.visualFlow?.edges.map(({ from, to }) => [from, to]), [["Bronze", "Validação"], ["Validação", "Silver"], ["Validação", "Quarentena"]]);
assert.match(quarantine.visualFlow?.scopeNote ?? "", /não afirma bucket dedicado nem execução em produção/i);
assert.ok(toVisualBrief(quarantine).visualAnchors.every((anchor) => anchor.length <= 38));
assert.ok(normalizeVisualAnchor("Se o seu pipeline falha toda vez que um payload chega corrompido").length <= 38);
const quarantinePrompt = buildImagePrompt({ title: cases[3].title, textContent: cases[3].text, editorialPillar: cases[3].pillar, contentBrief: quarantine });
assert.match(quarantinePrompt, /Bronze.*Validação.*Silver.*Quarentena/u);
assert.match(quarantinePrompt, /schema inválido/u);
assert.doesNotMatch(quarantinePrompt, /S3 quarantine bucket|dedicated S3 quarantine bucket/i);

console.log(`creative quality acceptance: ${cases.length} casos aprovados, incluindo quarentena e fluxo visual ramificado; nenhum post foi criado ou publicado.`);
