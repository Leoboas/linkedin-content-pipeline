export type CareerSourceKey = "HIMALAYAS" | "REMOTIVE" | "REMOTE_OK" | "CODERIO_LEVER" | "WE_WORK_REMOTELY";
export type CareerSourceMode = "ACTIVE_API" | "ACTIVE_RSS" | "AUTHORIZED_INTEGRATION" | "EMAIL_IMPORT" | "MANUAL_ONLY" | "BLOCKED";
export type JobEligibility = "BRAZIL_ELIGIBLE" | "LATAM_ELIGIBLE" | "WORLDWIDE_ELIGIBLE" | "RELOCATION_REQUIRED" | "REGION_RESTRICTED" | "UNKNOWN";

export interface SourcedJob {
  sourceKey: CareerSourceKey;
  externalId: string;
  title: string;
  company: string | null;
  location: string | null;
  remote: boolean;
  url: string;
  listingUrl?: string;
  description: string;
  publishedAt: string | null;
  attributionName: string;
  attributionUrl: string;
  sourceMode: CareerSourceMode;
  employerCountry: string | null;
  workLocationCountry: string | null;
  workplaceType: string | null;
}

export interface SourceResult {
  sourceKey: CareerSourceKey;
  mode: CareerSourceMode;
  status: "SUCCESS" | "EMPTY" | "ERROR" | "NOT_SELECTED";
  found: number;
  persisted?: number;
  error?: string;
}

export interface ConnectorBatch {
  jobs: SourcedJob[];
  results: SourceResult[];
}

type JsonRecord = Record<string, unknown>;
const USER_AGENT = "CareerIntelligence/1.1 (personal job discovery; contact: dashboard owner)";

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberString(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : string(value);
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stripHtml(value: string): string {
  return decodeXml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function normalizedUrl(value: unknown): string | null {
  const candidate = string(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function sourceHeaders(accept: string): HeadersInit {
  return { accept, "user-agent": USER_AGENT };
}

async function requestSource(url: URL, accept: string, fetcher: typeof fetch = fetch): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(url, { headers: sourceHeaders(accept), signal: AbortSignal.timeout(25_000), cache: "no-store" });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new Error(`HTTP ${response.status}`);
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5_000) : 400 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      if (error instanceof Error && /^HTTP (?!429$|5\d\d)/.test(error.message)) throw error;
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (2 ** attempt)));
    }
  }
  throw new Error("Fonte indisponível após novas tentativas.");
}

export async function requestSourceJson(url: URL, fetcher: typeof fetch = fetch): Promise<unknown> {
  return (await requestSource(url, "application/json", fetcher)).json() as Promise<unknown>;
}

export async function requestSourceText(url: URL, accept: string, fetcher: typeof fetch = fetch): Promise<string> {
  return (await requestSource(url, accept, fetcher)).text();
}

function fromHimalayas(value: unknown): SourcedJob[] {
  const jobs = record(value)?.jobs;
  return (Array.isArray(jobs) ? jobs : []).flatMap((item): SourcedJob[] => {
    const job = record(item);
    if (!job) return [];
    const id = string(job.guid) ?? string(job.id);
    const url = normalizedUrl(job.applicationLink);
    const title = string(job.title);
    if (!id || !url || !title) return [];
    const restrictions = Array.isArray(job.locationRestrictions) ? job.locationRestrictions.filter((entry): entry is string => typeof entry === "string").join(", ") : string(job.locationRestrictions);
    return [{ sourceKey: "HIMALAYAS", externalId: id, title, company: string(job.companyName), location: restrictions ?? string(job.location) ?? "Remote", remote: true, url, description: stripHtml(string(job.description) ?? string(job.excerpt) ?? ""), publishedAt: string(job.pubDate), attributionName: "Himalayas", attributionUrl: "https://himalayas.app", sourceMode: "ACTIVE_API", employerCountry: null, workLocationCountry: null, workplaceType: "remote" }];
  });
}

function fromRemotive(value: unknown): SourcedJob[] {
  const jobs = record(value)?.jobs;
  return (Array.isArray(jobs) ? jobs : []).flatMap((item): SourcedJob[] => {
    const job = record(item);
    if (!job) return [];
    const id = numberString(job.id);
    const url = normalizedUrl(job.url);
    const title = string(job.title);
    if (!id || !url || !title) return [];
    return [{ sourceKey: "REMOTIVE", externalId: id, title, company: string(job.company_name), location: string(job.candidate_required_location) ?? "Remote", remote: true, url, description: stripHtml(string(job.description) ?? ""), publishedAt: string(job.publication_date), attributionName: "Remotive", attributionUrl: "https://remotive.com", sourceMode: "ACTIVE_API", employerCountry: null, workLocationCountry: null, workplaceType: "remote" }];
  });
}

function fromRemoteOk(value: unknown): SourcedJob[] {
  if (!Array.isArray(value)) return [];
  return value.slice(1).flatMap((item): SourcedJob[] => {
    const job = record(item);
    if (!job) return [];
    const id = numberString(job.id) ?? string(job.slug);
    const url = normalizedUrl(job.url) ?? normalizedUrl(job.apply_url);
    const title = string(job.position);
    if (!id || !url || !title) return [];
    return [{ sourceKey: "REMOTE_OK", externalId: id, title, company: string(job.company), location: string(job.location) ?? "Remote", remote: true, url, description: stripHtml(string(job.description) ?? ""), publishedAt: string(job.date), attributionName: "Remote OK", attributionUrl: "https://remoteok.com", sourceMode: "ACTIVE_API", employerCountry: null, workLocationCountry: null, workplaceType: "remote" }];
  });
}

function fromLever(value: unknown): SourcedJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SourcedJob[] => {
    const job = record(item);
    const categories = record(job?.categories);
    const id = string(job?.id);
    const title = string(job?.text);
    const listingUrl = normalizedUrl(job?.hostedUrl);
    const applyUrl = normalizedUrl(job?.applyUrl);
    if (!job || !id || !title || !listingUrl || !applyUrl) return [];
    const description = stripHtml([job.descriptionPlain, job.openingPlain, job.descriptionBodyPlain, job.additionalPlain].map(string).filter((part): part is string => Boolean(part)).join("\n"));
    const location = [string(categories?.location), ...(Array.isArray(categories?.allLocations) ? categories.allLocations.filter((part): part is string => typeof part === "string") : [])].filter(Boolean).join(", ") || null;
    const workplaceType = string(job.workplaceType) ?? "unspecified";
    return [{ sourceKey: "CODERIO_LEVER", externalId: id, title, company: "Coderio", location, remote: workplaceType === "remote" || /\bremote\b|\bremoto\b/i.test(`${location ?? ""} ${description}`), url: applyUrl, listingUrl, description, publishedAt: typeof job.createdAt === "number" ? new Date(job.createdAt).toISOString() : string(job.createdAt), attributionName: "Coderio via Lever", attributionUrl: "https://jobs.lever.co/coderio", sourceMode: "ACTIVE_API", employerCountry: null, workLocationCountry: string(job.country), workplaceType }];
  });
}

function xmlTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

export function parseWeWorkRemotelyRss(xml: string): SourcedJob[] {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item): SourcedJob[] => {
    const titleAndCompany = xmlTag(item, "title");
    const url = normalizedUrl(xmlTag(item, "link"));
    const id = xmlTag(item, "guid") ?? url;
    if (!titleAndCompany || !url || !id) return [];
    const split = titleAndCompany.match(/^(.*?)\s+at\s+(.+)$/i);
    const title = (split?.[1] ?? titleAndCompany).trim();
    const company = split?.[2]?.trim() ?? null;
    const description = stripHtml(xmlTag(item, "description") ?? "");
    if (!title || !description) return [];
    const location = [xmlTag(item, "category"), description.match(/(?:Anywhere in the World|Worldwide|LATAM|Latin America|Brazil|Remote[^.\n]{0,100})/i)?.[0]].filter(Boolean).join(" · ") || "Remote (geografia não especificada)";
    return [{ sourceKey: "WE_WORK_REMOTELY", externalId: id, title, company, location, remote: true, url, listingUrl: url, description, publishedAt: xmlTag(item, "pubDate"), attributionName: "We Work Remotely", attributionUrl: "https://weworkremotely.com/remote-job-rss-feed", sourceMode: "ACTIVE_RSS", employerCountry: null, workLocationCountry: null, workplaceType: "remote" }];
  });
}

export async function fetchHimalayasJobs(fetcher: typeof fetch = fetch): Promise<SourcedJob[]> {
  const url = new URL("https://himalayas.app/jobs/api"); url.searchParams.set("limit", "20");
  return fromHimalayas(await requestSourceJson(url, fetcher));
}
export async function fetchRemotiveJobs(fetcher: typeof fetch = fetch): Promise<SourcedJob[]> {
  const url = new URL("https://remotive.com/api/remote-jobs"); url.searchParams.set("limit", "100");
  return fromRemotive(await requestSourceJson(url, fetcher));
}
export async function fetchRemoteOkJobs(fetcher: typeof fetch = fetch): Promise<SourcedJob[]> {
  return fromRemoteOk(await requestSourceJson(new URL("https://remoteok.com/api"), fetcher));
}
export async function fetchCoderioLeverJobs(fetcher: typeof fetch = fetch): Promise<SourcedJob[]> {
  const url = new URL("https://api.lever.co/v0/postings/coderio"); url.searchParams.set("mode", "json");
  return fromLever(await requestSourceJson(url, fetcher));
}
export async function fetchWeWorkRemotelyJobs(fetcher: typeof fetch = fetch): Promise<SourcedJob[]> {
  const xml = await requestSourceText(new URL("https://weworkremotely.com/remote-jobs.rss"), "application/rss+xml, application/xml, text/xml", fetcher);
  return parseWeWorkRemotelyRss(xml);
}

export const CAREER_SOURCE_REGISTRY = [
  { key: "CODERIO_LEVER", label: "Coderio / Lever", mode: "ACTIVE_API", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: true, priority: 1 },
  { key: "HIMALAYAS", label: "Himalayas", mode: "ACTIVE_API", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 2 },
  { key: "REMOTIVE", label: "Remotive", mode: "ACTIVE_API", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 2 },
  { key: "REMOTE_OK", label: "Remote OK", mode: "ACTIVE_API", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 2 },
  { key: "WE_WORK_REMOTELY", label: "We Work Remotely (RSS)", mode: "ACTIVE_RSS", applyMode: "SOURCE_SITE_REQUIRED", companyMarket: "UNKNOWN", monitored: false, priority: 2 },
  { key: "WELLFOUND", label: "Wellfound", mode: "EMAIL_IMPORT", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 2 },
  { key: "ARC_DEV", label: "Arc.dev", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "VANHACK", label: "VanHack", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "ANDELA", label: "Andela", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "LEMON_IO", label: "Lemon.io", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "EU_REMOTE_JOBS", label: "EU Remote Jobs", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "EU", monitored: false, priority: 3 },
  { key: "Y_COMBINATOR", label: "Y Combinator Jobs", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "LANDING_JOBS", label: "Landing.Jobs", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "EU", monitored: false, priority: 3 },
  { key: "RELOCATE_ME", label: "Relocate.me", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "EU", monitored: false, priority: 3 },
  { key: "GREENHOUSE", label: "Greenhouse ATS", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "ASHBY", label: "Ashby ATS", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "WORKABLE", label: "Workable ATS", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "SMARTRECRUITERS", label: "SmartRecruiters ATS", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
  { key: "LEVER_OTHER_COMPANIES", label: "Lever (outras empresas, board pendente)", mode: "MANUAL_ONLY", applyMode: "OFFICIAL_APPLY_URL", companyMarket: "UNKNOWN", monitored: false, priority: 3 },
] as const;

export const CAREER_APPLICATION_CAPABILITIES = [
  { sourceKey: "CODERIO_LEVER", programmaticApply: false, mode: "OFFICIAL_APPLY_URL", reason: "A Lever application POST exige uma API key gerada por administrador empregador; a conta do candidato não concede esse acesso." },
  { sourceKey: "WE_WORK_REMOTELY", programmaticApply: false, mode: "SOURCE_SITE_REQUIRED", reason: "A candidatura deve continuar pelo site da We Work Remotely." },
  { sourceKey: "WELLFOUND", programmaticApply: false, mode: "OFFICIAL_APPLY_URL", reason: "Sem API autorizada para candidatura nesta integração; abrir o fluxo oficial do Wellfound." },
  { sourceKey: "HIMALAYAS_REMOTIVE_REMOTE_OK", programmaticApply: false, mode: "OFFICIAL_APPLY_URL", reason: "Usar o link oficial da vaga; nenhum endpoint de candidatura de candidato foi autorizado." },
] as const;

export async function fetchCareerSources(options: { sourceKeys?: string[]; fetcher?: typeof fetch } = {}): Promise<ConnectorBatch> {
  const fetcher = options.fetcher ?? fetch;
  const connectors: Array<{ sourceKey: CareerSourceKey; mode: CareerSourceMode; fetchJobs: () => Promise<SourcedJob[]> }> = [
    { sourceKey: "CODERIO_LEVER", mode: "ACTIVE_API", fetchJobs: () => fetchCoderioLeverJobs(fetcher) },
    { sourceKey: "HIMALAYAS", mode: "ACTIVE_API", fetchJobs: () => fetchHimalayasJobs(fetcher) },
    { sourceKey: "REMOTIVE", mode: "ACTIVE_API", fetchJobs: () => fetchRemotiveJobs(fetcher) },
    { sourceKey: "REMOTE_OK", mode: "ACTIVE_API", fetchJobs: () => fetchRemoteOkJobs(fetcher) },
    { sourceKey: "WE_WORK_REMOTELY", mode: "ACTIVE_RSS", fetchJobs: () => fetchWeWorkRemotelyJobs(fetcher) },
  ];
  const selected = options.sourceKeys?.length ? new Set(options.sourceKeys) : null;
  const jobs: SourcedJob[] = [];
  const results: SourceResult[] = [];
  for (const connector of connectors) {
    if (selected && !selected.has(connector.sourceKey)) {
      results.push({ sourceKey: connector.sourceKey, mode: connector.mode, status: "NOT_SELECTED", found: 0 });
      continue;
    }
    try {
      const found = await connector.fetchJobs();
      jobs.push(...found);
      results.push({ sourceKey: connector.sourceKey, mode: connector.mode, status: found.length ? "SUCCESS" : "EMPTY", found: found.length });
    } catch (error) {
      results.push({ sourceKey: connector.sourceKey, mode: connector.mode, status: "ERROR", found: 0, error: error instanceof Error ? error.message : "Erro desconhecido" });
    }
  }
  const deduplicated = new Map<string, SourcedJob>();
  for (const job of jobs) deduplicated.set(`${job.sourceKey}:${job.externalId}`, job);
  return { jobs: [...deduplicated.values()], results };
}

const ENGINEERING_TERMS = /python|backend|back-end|software engineer|data engineer|data platform|platform engineer|full.?stack|tech lead|software architect|engineering/i;
const TECH_TERMS = /python|sql|postgres|aws|airflow|spark|pyspark|fastapi|django|flask|node\.js|typescript|java|kafka|docker|kubernetes|data pipeline|etl|backend|software engineering/i;
export function isRelevantEngineeringJob(job: Pick<SourcedJob, "title" | "description">): boolean {
  return ENGINEERING_TERMS.test(job.title.toLocaleLowerCase("en-US")) && TECH_TERMS.test(`${job.title} ${job.description}`.toLocaleLowerCase("en-US"));
}
export function jobDeduplicationKey(job: Pick<SourcedJob, "title" | "company" | "location">): string {
  return [job.title, job.company ?? "", job.location ?? ""].map((value) => value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim()).join("|");
}

export function normalizeCountryCode(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase("en-US").replace(/[._-]/g, " ").replace(/\s+/g, " ");
  const countries: Record<string, string> = { brasil: "BR", brazil: "BR", br: "BR", "brazil remote": "BR", "united states": "US", "united states of america": "US", usa: "US", us: "US", eua: "US", "estados unidos": "US", "united kingdom": "GB", uk: "GB", "great britain": "GB", "reino unido": "GB", canada: "CA", ca: "CA", germany: "DE", alemanha: "DE", portugal: "PT", france: "FR", frança: "FR", europe: "EU", remote: "REMOTE", remoto: "REMOTE", worldwide: "WORLDWIDE", global: "WORLDWIDE" };
  return countries[normalized] ?? (/^[a-z]{2}$/i.test(normalized) ? normalized.toUpperCase() : null);
}

export function assessJobEligibility(job: Pick<SourcedJob, "title" | "location" | "description" | "remote">, preferredLocations: string[]): { status: JobEligibility; reasons: string[] } {
  const content = `${job.location ?? ""} ${job.description}`.toLocaleLowerCase("en-US");
  const wantsBrazil = preferredLocations.some((location) => normalizeCountryCode(location) === "BR");
  const usOnly = /\b(us only|u\.s\. only|united states only|must be (?:located|based) in the (?:u\.s\.|united states)|only candidates? in (?:the )?u\.s\.|u\.s\. work authorization required|must have (?:a )?us work authorization)\b/i.test(content);
  const relocation = /relocation (?:required|provided)|must relocate|visa sponsorship (?:is )?not (?:available|provided)|must be authorized to work in/i.test(content);
  const hiresRemotelyFrom = content.match(/hires? remotely from\s*[:\-]\s*([^\n.]{2,180})/i)?.[1] ?? "";
  const explicitCountries = /hires? remotely from\s*[:\-]/i.test(content);
  const excludedBrazil = /\b(?:not|cannot|can't|unable to|do not|don't|excluding|except|outside)\b.{0,80}\b(brazil|brasil)\b|\b(brazil|brasil)\b.{0,80}\b(?:not eligible|not available|excluded|cannot hire|can't hire|do not hire)\b/i.test(content);
  const brazil = /\b(brazil|brasil)\b/i.test(content) && !excludedBrazil;
  const latam = /\b(latam|latin america|south america|américa latina|america latina)\b/i.test(content);
  const worldwide = /\b(worldwide|global|anywhere in the world|work from anywhere)\b/i.test(content);
  if (relocation) return { status: "RELOCATION_REQUIRED", reasons: ["A vaga menciona mudança de país, autorização de trabalho ou relocation como condição."] };
  if (excludedBrazil) return { status: "REGION_RESTRICTED", reasons: ["A descrição exclui explicitamente candidatos residentes no Brasil."] };
  if (explicitCountries && !/\b(brazil|brasil|latam|latin america|south america|worldwide|global|anywhere)\b/i.test(hiresRemotelyFrom)) {
    return { status: "REGION_RESTRICTED", reasons: [`A lista explícita de países aceitos não inclui o Brasil: ${hiresRemotelyFrom.trim()}.`] };
  }
  if (usOnly && wantsBrazil) return { status: "REGION_RESTRICTED", reasons: ["A descrição restringe explicitamente a residência ou autorização de trabalho aos EUA."] };
  if (brazil) return { status: "BRAZIL_ELIGIBLE", reasons: ["Brasil é explicitamente citado como localização aceita; confirme a modalidade de contratação no formulário oficial."] };
  if (latam) return { status: "LATAM_ELIGIBLE", reasons: ["A vaga cita América Latina/LATAM; confirme se o Brasil está incluído no fluxo oficial."] };
  if (worldwide) return { status: "WORLDWIDE_ELIGIBLE", reasons: ["A vaga declara contratação mundial; ainda confirme entidade contratante, vínculo e fuso horário."] };
  if (usOnly) return { status: "REGION_RESTRICTED", reasons: ["A descrição restringe explicitamente a vaga aos EUA."] };
  return { status: "UNKNOWN", reasons: [job.remote ? "Remoto não significa contratação permitida no Brasil; a fonte não confirma países de residência." : "A fonte não fornece evidência suficiente sobre contratação internacional."] };
}
