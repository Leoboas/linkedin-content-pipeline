import { readFile } from "node:fs/promises";
import { Prisma, EditorialPillar, FunnelStage, FormatType, PostStatus, QualityGateStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.ts";
import { generateImageWithFallback } from "../src/lib/creative-renderer.ts";
import { predictEngagement } from "../src/lib/analytics.ts";
import { sendPostForApproval } from "../src/lib/telegram.ts";
import { getNextPipelineBaseDate, scheduledDateForPillar } from "../src/lib/scheduling.ts";

async function loadEnvFile(filePath: string): Promise<void> {
  try {
    const text = await readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^#=]+)=(.*)$/.exec(line);
      if (match && process.env[match[1].trim()] === undefined) {
        process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const title = "O desafio de uma plataforma de veículos conectados é sobreviver à falha";
const textContent = [
  "O problema mais difícil de uma plataforma de veículos conectados não é armazenar telemetria.",
  "É não perder a história quando a conectividade falha.",
  "",
  "No DriveSense, tratei cada registro como um evento que precisa sobreviver a atraso, duplicidade e dados inválidos.",
  "",
  "A arquitetura segue um caminho claro:",
  "• buffer local em SQLite para operação offline-first;",
  "• recuperação ordenada com event_id e idempotência;",
  "• S3 Bronze para preservar o JSON bruto;",
  "• AWS Glue e PySpark para transformar e catalogar Parquet na camada Silver;",
  "• Athena para consultas analíticas;",
  "• Streamlit para apresentar os dados sem credenciais AWS no dashboard local.",
  "",
  "O ponto principal não é escolher mais serviços. É tornar a falha observável, reprocessável e auditável.",
  "",
  "Também deixei a infraestrutura descrita em Terraform, com IAM de menor privilégio, bloqueio de acesso público e validação por CI. O apply continua deliberadamente separado do repositório.",
  "",
  "É um projeto de portfólio com dados sintéticos, mas os trade-offs são os mesmos que aparecem em plataformas reais de dados e IoT.",
  "",
  "Repositório: https://github.com/Leoboas/drivesense-connected-vehicle-platform",
  "",
  "Qual seria sua primeira decisão arquitetural para lidar com eventos atrasados e duplicados?",
  "",
  "#DataEngineering #Python #AWS #DataLake #PySpark #Terraform #IoT #SoftwareArchitecture",
].join("\n");

const imagePrompt = [
  "High-end editorial enterprise architecture visual for a LinkedIn post about the DriveSense Connected Vehicle Platform.",
  "Show an abstract connected vehicle telemetry stream flowing through a local offline SQLite edge buffer into AWS S3 Bronze immutable JSON, then AWS Glue and PySpark into Silver partitioned Parquet, Athena analytics, and a clean Streamlit dashboard.",
  "Dark navy background, cyan data flows, restrained amber reliability highlights, clean isometric architecture, premium technology magazine composition, realistic subtle depth, no people, no brand logos, no readable text, no typography, no watermark, no duplicated elements, no visual clutter.",
].join(" ");

async function main(): Promise<void> {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  const generationKey = "manual:drivesense-connected-vehicle-platform:v1";
  const existing = await prisma.post.findUnique({ where: { generationKey } });
  if (existing) {
    console.log(`Post DriveSense já existe (${existing.id}) com status ${existing.status}.`);
    if (existing.status !== PostStatus.PUBLISHED && existing.status !== PostStatus.CANCELLED && existing.status !== PostStatus.ARCHIVED) {
      const ready = existing.status === PostStatus.DRAFT
        ? await prisma.post.update({ where: { id: existing.id }, data: { status: PostStatus.AWAITING_APPROVAL } })
        : existing;
      await sendPostForApproval(ready);
      console.log("Card de aprovação reenviado ao Telegram.");
    }
    return;
  }

  const editorialLine = await prisma.editorialLine.findFirst({ orderBy: { createdAt: "asc" } });
  if (!editorialLine) throw new Error("Nenhuma EditorialLine cadastrada para orientar o post.");

  const prediction = predictEngagement({
    title,
    textContent,
    editorialPillar: EditorialPillar.BOFU,
    dossier: `${editorialLine.toneOfVoice}\n${editorialLine.cvCases}`,
  });
  const baseDate = getNextPipelineBaseDate(new Date());
  const scheduledDate = scheduledDateForPillar(EditorialPillar.BOFU, baseDate);
  const slides = [{
    title: "DriveSense: dados que sobrevivem à falha",
    bullets: [
      "SQLite mantém eventos no edge quando a conectividade cai",
      "S3 Bronze preserva o dado bruto para auditoria e reprocessamento",
      "Glue/PySpark transforma em Parquet e Athena prepara a análise",
    ],
  }];

  const post = await prisma.post.create({
    data: {
      generationKey,
      editorialLineId: editorialLine.id,
      editorialPillar: EditorialPillar.BOFU,
      funnelStage: FunnelStage.DESIRE,
      formatType: FormatType.SINGLE_IMAGE,
      title,
      textContent,
      imagePrompt,
      slidesJson: slides as unknown as Prisma.InputJsonValue,
      engagementScore: prediction.score,
      engagementLabel: prediction.label,
      qualityScore: 84,
      qualityStatus: QualityGateStatus.PASS,
      qualityReview: {
        source: "drive-sense-manual-editorial-review",
        summary: "Post técnico preparado para revisão humana antes da publicação.",
      } as Prisma.InputJsonValue,
      status: PostStatus.AWAITING_APPROVAL,
      scheduledFor: scheduledDate,
      scheduledDate,
    },
  });

  try {
    const mediaUrl = await generateImageWithFallback({
      postId: post.id,
      title,
      editorialPillar: EditorialPillar.BOFU,
      imagePrompt,
    });
    const updated = await prisma.post.update({ where: { id: post.id }, data: { mediaUrl } });
    await sendPostForApproval(updated);
    console.log(JSON.stringify({ id: updated.id, status: updated.status, scheduledDate: updated.scheduledDate, mediaUrl }, null, 2));
  } catch (error) {
    await prisma.post.update({ where: { id: post.id }, data: { status: PostStatus.DRAFT, rejectionFeedback: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

main()
  .catch((error: unknown) => {
    console.error("Falha ao criar o post do DriveSense:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
