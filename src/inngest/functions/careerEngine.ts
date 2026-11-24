import { inngest } from "@/inngest/client";
import { runCareerScan } from "@/lib/career-engine";
import { prepareApplicationKit } from "@/lib/career-application-kit";
import type { CareerSourceKey } from "@/lib/job-source-connectors";
import { dispatchSubmission, processSubmission } from "@/lib/career-submission";
import { prisma } from "@/lib/prisma";

export const careerSearchPipeline = inngest.createFunction(
  { id: "career-daily-job-hunter", retries: 2 },
  { event: "career/scan.requested" },
  async ({ event, step }) => {
    const data = event.data as { runId?: string; maxJobs?: number; sourceKeys?: CareerSourceKey[] };
    try {
      const result = await step.run("search-match-and-audit", () => runCareerScan(data.runId, data.maxJobs && data.sourceKeys?.length ? { maxJobs: data.maxJobs, sourceKeys: data.sourceKeys } : undefined, event.id));
      console.info("[career/inngest] execução concluída", { runId: result.runId, discovered: result.discovered, matches: result.matches.length, sourceRequests: result.queries });
      return { runId: result.runId, discovered: result.discovered, matches: result.matches.length };
    } catch (error) {
      console.error("[career/inngest] execução falhou", { runId: data.runId, error: error instanceof Error ? error.message : "Erro desconhecido" });
      throw error;
    }
  },
);

export const prepareCareerApplicationKit = inngest.createFunction(
  {
    id: "career-prepare-application-kit",
    retries: 2,
    idempotency: "event.data.requestKey",
    concurrency: { limit: 1, key: "event.data.applicationId" },
  },
  { event: "career/application.prepare.requested" },
  async ({ event, step }) => {
    const data = event.data as { applicationId: string; requestKey: string };
    if (!data.applicationId || !data.requestKey) throw new Error("Evento de preparação de candidatura sem chave idempotente.");
    return step.run("prepare-versioned-application-kit", () => prepareApplicationKit(data.applicationId, data.requestKey));
  },
);

export const submitCareerApplication = inngest.createFunction(
  { id: "career-submit-approved-application", retries: 2, concurrency: { limit: 1, key: "event.data.submissionId" } },
  { event: "career/application.submit.requested" },
  async ({ event, step }) => {
    const id = (event.data as { submissionId?: string }).submissionId;
    if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error("Identificador de envio inválido.");
    return step.run("submit-authorized-package", () => processSubmission(id));
  },
);

export const recoverCareerSubmissionOutbox = inngest.createFunction(
  { id: "career-submission-outbox", retries: 2 },
  { cron: "*/5 * * * *" },
  async ({ step }) => step.run("recover-pending-submissions", async () => {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const pending = await prisma.applicationSubmission.findMany({ where: { state: "QUEUED", OR: [{ dispatchedAt: null }, { dispatchedAt: { lt: cutoff } }] }, select: { id: true }, take: 25 });
    for (const item of pending) await dispatchSubmission(item.id);
    // A crash after the portal request started cannot be retried safely.
    await prisma.applicationSubmission.updateMany({ where: { state: "SUBMITTING", submittingAt: { lt: cutoff } }, data: { state: "UNCERTAIN", reason: "O resultado do envio não foi confirmado. Confira o portal antes de tentar novamente." } });
    await prisma.applicationSubmission.updateMany({ where: { state: "FILLING", startedAt: { lt: cutoff } }, data: { state: "NEEDS_ACTION", reason: "A preparação foi interrompida antes do envio; revise o pacote." } });
    return { pending: pending.length };
  }),
);
