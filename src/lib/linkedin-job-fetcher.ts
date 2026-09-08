export interface PublicLinkedInJob {
  linkedinJobId: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
}

const SEARCH_ENDPOINT = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]{1,4});/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d{1,5});/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(block: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<[^>]+class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)</[^>]+>`, "i"));
  const text = match?.[1] ? decodeHtml(match[1]) : "";
  return text || null;
}

function extractUrl(block: string): string | null {
  const match = block.match(/<a[^>]+class=["'][^"']*base-card__full-link[^"']*["'][^>]+href=["']([^"']+)["']/i)
    ?? block.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*base-card__full-link[^"']*["']/i);
  if (!match?.[1]) return null;
  const href = decodeHtml(match[1]).split("?")[0];
  return href.startsWith("http") ? href : `https://www.linkedin.com${href.startsWith("/") ? "" : "/"}${href}`;
}

function extractJobId(block: string, url: string): string | null {
  const urn = block.match(/data-entity-urn=["'][^"']*:(\d+)["']/i)?.[1];
  if (urn) return urn;
  return url.match(/\/jobs\/view\/(\d+)/i)?.[1] ?? null;
}

export async function fetchLinkedInPublicJobs(keyword: string, location: string): Promise<PublicLinkedInJob[]> {
  const query = new URLSearchParams({ keywords: keyword, location, f_TPR: "r86400" });
  const response = await fetch(`${SEARCH_ENDPOINT}?${query.toString()}`, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`LinkedIn Guest Jobs retornou HTTP ${response.status}.`);

  const html = await response.text();
  const blocks = html.match(/<li\b[\s\S]*?<\/li>/gi) ?? [];
  const jobs = blocks.flatMap((block): PublicLinkedInJob[] => {
    const url = extractUrl(block);
    const linkedinJobId = url ? extractJobId(block, url) : null;
    const title = extractText(block, "base-search-card__title");
    if (!url || !linkedinJobId || !title) return [];
    return [{
      linkedinJobId,
      title,
      company: extractText(block, "base-search-card__subtitle"),
      location: extractText(block, "job-search-card__location"),
      url,
    }];
  });
  return [...new Map(jobs.map((job) => [job.linkedinJobId, job])).values()];
}
