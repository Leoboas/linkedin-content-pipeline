import assert from "node:assert/strict";
import { buildContentBrief } from "../src/lib/creative-brief.ts";
import { buildImagePrompt } from "../src/lib/image-prompt-engine.ts";
import { assertContentQuality } from "../src/lib/content-quality.ts";
import { getPublicationEligibility } from "../src/lib/publication-eligibility.ts";
import { FormatType, PostStatus, QualityGateStatus } from "@prisma/client";

// Offline acceptance fixtures. Evidence is synthetic and explicitly labeled as
// such; this test never claims a real project result or calls an AI provider.
const cases = [
  {
    language: "pt-BR",
    title: "Dados corretos tambem podem chegar tarde?",
    pillar: "TOFU" as const,
    evidence: [{ id: "fixture-freshness", source: "fixture://timestamped-events", kind: "PORTFOLIO_PROJECT" as const, claim: "Fixture: eventos possuem timestamps de origem, processamento e publicacao.", verified: true }],
    text: "O numero esta certo. A decisao ainda pode estar errada?\n\nQuando o dado chega depois da janela operacional, precisao nao resolve defasagem. A equipe precisa saber a idade da informacao que esta usando.\n\nUm diagnostico comeca registrando tres momentos: evento na origem, processamento concluido e disponibilidade para consumo. A diferenca entre eles mostra onde o atraso se acumula.\n\nNa fixture deste teste, esses timestamps permitem distinguir atraso de origem de demora no processamento, sem atribuir causa antes de medir.\n\nO dashboard nao precisa esconder o atraso; precisa torna-lo visivel para quem decide.\n\nQual decisao no seu time depende de saber quando o dado foi atualizado?",
  },
  {
    language: "en-US",
    title: "A schema change is an operational event",
    pillar: "MOFU" as const,
    evidence: [{ id: "fixture-schema-contract", source: "fixture://schema-contract", kind: "CONCEPTUAL_KNOWLEDGE" as const, claim: "Fixture: a data contract records schema compatibility and rejected records.", verified: true }],
    text: "A schema change is not just a producer-side detail. Who finds out when it breaks a consumer?\n\nWithout an explicit compatibility rule, a field change can become a late incident. The key decision is whether consumers tolerate additive changes and how incompatible records are handled.\n\nIn this test fixture, the contract records the expected schema and rejected records. It does not claim a production result; it makes the failure mode observable.\n\nThat gives the team a clear place to inspect before adding more compute or another service.\n\nWhich contract in your data platform still depends on a verbal agreement?",
  },
  {
    language: "pt-BR",
    title: "Uma fila nao garante processamento confiavel",
    pillar: "BOFU" as const,
    evidence: [{ id: "fixture-async-flow", source: "fixture://async-processing", kind: "PORTFOLIO_PROJECT" as const, claim: "Fixture: uma fila desacopla recebimento da execucao e registra estados de processamento.", verified: true }],
    text: "A solicitacao foi aceita. O trabalho realmente terminou?\n\nEm processamento assincrono, a resposta da API confirma o recebimento; o resultado depende do worker, da persistencia do estado e do tratamento de falhas.\n\nA fixture descreve uma fila entre recebimento e execucao, com estados registrados. Esse desenho permite separar aceite, processamento e conclusao sem prometer disponibilidade ou desempenho que nao medimos.\n\nO trade-off e introduzir mais estados operacionais em troca de desacoplamento e retomada explicita.\n\nComo seu sistema diferencia uma tarefa aceita de uma tarefa realmente concluida?",
  },
  {
    language: "en-US",
    title: "Retries need an idempotency boundary",
    pillar: "MOFU" as const,
    evidence: [{ id: "fixture-idempotency", source: "fixture://idempotent-worker", kind: "CONCEPTUAL_KNOWLEDGE" as const, claim: "Fixture: repeated delivery is safe only when side effects use an idempotency key.", verified: true }],
    text: "A retry can recover work. What happens if it repeats the side effect?\n\nThe design question is not whether a worker retries, but where duplicate execution becomes harmless. An idempotency key gives the operation a stable identity across delivery attempts.\n\nThis test fixture states the boundary explicitly: repeated delivery is safe only when side effects are keyed and persisted. It makes no claim about throughput or a production incident.\n\nThat boundary should be tested at the persistence point, not inferred from a successful queue acknowledgement.\n\nWhere does your system make a repeated request safe?",
  },
];

for (const item of cases) {
  const slides = [{ title: "The engineering decision", bullets: [item.evidence[0].claim] }];
  assertContentQuality({ title: item.title, textContent: item.text, editorialPillar: item.pillar, slides });
  const brief = buildContentBrief({ title: item.title, textContent: item.text, editorialPillar: item.pillar, projectEvidence: item.evidence });
  assert.equal(brief.evidence.length, 1);
  assert.ok(brief.evidence[0].source?.startsWith("fixture://"));
  const prompt = buildImagePrompt({ title: item.title, textContent: item.text, editorialPillar: item.pillar, contentBrief: brief });
  assert.match(prompt, /Technical conflict to visualize/u);
  assert.match(prompt, /Negative prompt/u);
  assert.doesNotMatch(`${item.title} ${item.text}`, /Autonomous LinkedIn Content Engine|machine learning|Isolation Forest/iu);
  const signals = item.language === "en-US" ? /\b(the|and|when|which|without|where)\b/iu : /\b(o|a|que|quando|sem|qual)\b/iu;
  assert.match(`${item.title} ${item.text}`, signals);
}

const blocked = { status: PostStatus.DRAFT, qualityStatus: QualityGateStatus.NEEDS_REVISION, qualityScore: 61, publishedAt: null, formatType: FormatType.SINGLE_IMAGE, mediaUrl: "https://example.invalid/creative.png", qualityReview: { renderedImage: { status: "PASS", reviewedMediaUrl: "https://example.invalid/creative.png" } }, currentVersionId: "version-1", approvedCreativeBriefId: "creative-1", approvedCreativeBrief: { id: "creative-1", postVersionId: "version-1", reviewStatus: QualityGateStatus.PASS, mediaUrl: "https://example.invalid/creative.png" } };
assert.equal(getPublicationEligibility(blocked).eligible, false);
assert.equal(getPublicationEligibility({ ...blocked, status: PostStatus.APPROVED, qualityStatus: QualityGateStatus.PASS, qualityScore: 84 }).eligible, true);
assert.equal(getPublicationEligibility({ ...blocked, status: PostStatus.APPROVED, qualityStatus: QualityGateStatus.PASS, qualityScore: 84, mediaUrl: "https://example.invalid/replaced.png" }).eligible, false, "A stale review cannot authorize a replaced creative");

console.log(`multilingual creative acceptance: ${cases.length} synthetic fixtures passed copy/evidence/visual checks; publication gate passed; no API calls, DB writes or LinkedIn publishing.`);
