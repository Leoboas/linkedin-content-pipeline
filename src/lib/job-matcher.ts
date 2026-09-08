import { JobListingStatus, JobSource } from "@prisma/client";
import { analyzeManualJob } from "@/lib/career-engine";
import { prisma } from "@/lib/prisma";

export interface InboundJobInput {
  url: string;
  subject?: string;
  body: string;
}

export interface InboundJobAnalysis {
  isNew: boolean;
  jobId: string;
  title: string;
  score: number;
  label: string;
  matchedSkills: string[];
  skillGaps: string[];
  rationale: string;
  pitch: string;
  jobUrl: string;
}

function cleanTitle(subject: string | undefined): string {
  const value = subject?.trim();
  return value && value.length <= 180 ? value : "Vaga recebida por e-mail";
}

async function readWithJina(url: string): Promise<string | null> {
  // Jina is a lightweight reader; the e-mail body remains the source of truth
  // when LinkedIn or Jina does not expose the public job description.
  const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
  const headers: HeadersInit = { Accept: "text/plain" };
  if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  try {
    const response = await fetch(jinaUrl, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const content = (await response.text()).trim();
    return content ? content.slice(0, 100_000) : null;
  } catch (error) {
    console.warn("[job-matcher] Jina Reader indisponivel; usando corpo recebido", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function matchInboundJob(input: InboundJobInput): Promise<InboundJobAnalysis> {
  const url = new URL(input.url).toString();
  const existing = await prisma.jobListing.findUnique({ where: { source_externalId: { source: JobSource.MANUAL, externalId: url } } });
  const jinaContent = await readWithJina(url);
  const description = (input.body.trim() || jinaContent || "Descricao recebida por e-mail.").slice(0, 100_000);
  const job = existing
    ? await prisma.jobListing.update({ where: { id: existing.id }, data: { title: cleanTitle(input.subject) !== "Vaga recebida por e-mail" ? cleanTitle(input.subject) : existing.title, description, status: JobListingStatus.OPEN } })
    : await prisma.jobListing.create({ data: { source: JobSource.MANUAL, externalId: url, title: cleanTitle(input.subject), url, description, status: JobListingStatus.OPEN } });
  const analysis = await analyzeManualJob(job.id, description);
  return { isNew: !existing, jobId: job.id, ...analysis };
}
