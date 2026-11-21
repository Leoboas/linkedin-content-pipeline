import assert from "node:assert/strict";
import { assessJobEligibility, CAREER_APPLICATION_CAPABILITIES, fetchCareerSources, isRelevantEngineeringJob, jobDeduplicationKey, normalizeCountryCode, parseWeWorkRemotelyRss, requestSourceJson } from "../src/lib/job-source-connectors";
import { AUTHORIZED_RESUMES, getResumeMetadataByName, recommendAuthorizedResume } from "../config/authorized-resumes";
import { ASSOCIATED_JOB_TITLES, normalizeCareerTargetTitles, TARGET_JOB_TITLES } from "../config/job-targets";
import { calculateMatch } from "../src/lib/career-rag";

assert.ok(TARGET_JOB_TITLES.includes("Python Backend Engineer"));
assert.ok(TARGET_JOB_TITLES.includes("Data Engineer"));
assert.ok(TARGET_JOB_TITLES.includes("Analytics Engineer"));
assert.deepEqual(normalizeCareerTargetTitles(["Python Backend Engineer", "Marketing Executive", "Growth Manager", "AWS Data Engineer"]), ["Python Backend Engineer", "AWS Data Engineer"]);
assert.deepEqual(normalizeCareerTargetTitles(["Head of Marketing", "Media Buyer"]), [], "historical marketing roles must not become engineering search targets");
const matchCase = calculateMatch({
  profileSkills: ["Python", "FastAPI", "PostgreSQL", "AWS", "Apache Airflow"],
  profileContext: "Senior Python Backend Engineer. Built REST APIs, PostgreSQL data systems, AWS services and data pipelines. Technical Lead.",
  jobTitle: "Senior Python Backend Engineer",
  jobDescription: "Build Python REST APIs and backend systems with PostgreSQL and AWS. Design system architecture and observability.",
});
assert.equal(matchCase.scoreVersion, "career-match-v2");
assert.ok(matchCase.score >= 0 && matchCase.score <= 100);
assert.ok(matchCase.scoreBreakdown.technicalSkills > 0 && matchCase.scoreBreakdown.roleAlignment > 0);
assert.ok(matchCase.matchedSkills.includes("Python (Programming Language)"));

assert.equal(normalizeCountryCode("Brasil"), "BR");
assert.equal(normalizeCountryCode("Brazil"), "BR");
assert.equal(normalizeCountryCode("Estados Unidos"), "US");
assert.equal(normalizeCountryCode("Remote"), "REMOTE");
assert.equal(assessJobEligibility({ title: "Python Engineer", location: "United States", description: "Must be located in the U.S. Remote within US only.", remote: true }, ["BR"]).status, "REGION_RESTRICTED");
assert.equal(assessJobEligibility({ title: "Data Engineer", location: "Worldwide", description: "Remote, worldwide candidates welcome.", remote: true }, ["BR"]).status, "WORLDWIDE_ELIGIBLE");
assert.equal(assessJobEligibility({ title: "Python Engineer", location: "Remote", description: "Hiring in Brazil", remote: true }, ["BR"]).status, "BRAZIL_ELIGIBLE");
assert.equal(assessJobEligibility({ title: "Engineer", location: "Remote", description: "LATAM time zones", remote: true }, ["BR"]).status, "LATAM_ELIGIBLE");
assert.equal(assessJobEligibility({ title: "Engineer", location: "Remote", description: "Must relocate to Germany and have work authorization", remote: true }, ["BR"]).status, "RELOCATION_REQUIRED");
assert.equal(assessJobEligibility({ title: "Python Engineer", location: "Remote", description: "Hires remotely from: United States, Canada", remote: true }, ["BR"]).status, "REGION_RESTRICTED");
assert.equal(assessJobEligibility({ title: "Python Engineer", location: "Remote", description: "Worldwide remote, but we cannot hire residents in Brazil", remote: true }, ["BR"]).status, "REGION_RESTRICTED");
assert.equal(assessJobEligibility({ title: "Python Engineer", location: "Remote", description: "Remote role; countries not listed", remote: true }, ["BR"]).status, "UNKNOWN");
assert.equal(isRelevantEngineeringJob({ title: "Senior Python Backend Engineer", description: "Python, FastAPI, PostgreSQL" }), true);
assert.equal(isRelevantEngineeringJob({ title: "Marketing Manager", description: "Campaign operations" }), false);
assert.equal(jobDeduplicationKey({ title: "Python Engineer", company: "Example Inc.", location: "Brazil Remote" }), jobDeduplicationKey({ title: "Python Engineer", company: "example-inc", location: "Brazil Remote" }));
assert.equal(recommendAuthorizedResume({ title: "Data Engineer", description: "Python, Airflow, ETL", languageHint: "EN" })?.resumeKey, AUTHORIZED_RESUMES.dataEngineeringEn.resumeKey);
assert.equal(recommendAuthorizedResume({ title: "Backend Python Engineer", description: "FastAPI", languageHint: "PT_BR" })?.resumeKey, AUTHORIZED_RESUMES.pythonBackendPtBr.resumeKey);
assert.equal(recommendAuthorizedResume({ title: "Growth Marketing Manager", description: "Paid media" }), null);
assert.ok(getResumeMetadataByName(AUTHORIZED_RESUMES.dataEngineeringEn.originalName));
assert.equal(getResumeMetadataByName("another-resume.docx"), null);

async function main() {
  const rss = parseWeWorkRemotelyRss(`<rss><channel><item><title>Senior Python Engineer at Example</title><link>https://weworkremotely.com/remote-jobs/example-1</link><guid>job-1</guid><description><![CDATA[Remote role. Hiring in Brazil and LATAM. Python, FastAPI and PostgreSQL.]]></description><category>Programming</category><pubDate>Thu, 19 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
  assert.equal(rss.length, 1);
  assert.equal(rss[0].company, "Example");
  assert.equal(rss[0].sourceMode, "ACTIVE_RSS");
  assert.equal(rss[0].attributionName, "We Work Remotely");
  const leverOnly = await fetchCareerSources({ sourceKeys: ["CODERIO_LEVER"], fetcher: async () => new Response(JSON.stringify([{ id: "lever-id", text: "Senior Python Engineer", categories: { location: "Remote" }, workplaceType: "remote", hostedUrl: "https://jobs.lever.co/coderio/lever-id", applyUrl: "https://jobs.lever.co/coderio/lever-id/apply", descriptionPlain: "Build Python backend systems." }]), { status: 200, headers: { "content-type": "application/json" } }) });
  assert.equal(leverOnly.jobs.length, 1);
  assert.equal(leverOnly.jobs[0].url, "https://jobs.lever.co/coderio/lever-id/apply");
  assert.equal(leverOnly.jobs[0].listingUrl, "https://jobs.lever.co/coderio/lever-id");
  assert.ok(leverOnly.results.filter((source) => source.status !== "NOT_SELECTED").every((source) => source.sourceKey === "CODERIO_LEVER"));
  assert.ok(CAREER_APPLICATION_CAPABILITIES.every((provider) => provider.programmaticApply === false));

  let attempts = 0;
  const retryPayload = await requestSourceJson(new URL("https://example.test/jobs"), async () => {
    attempts += 1;
    return attempts === 1 ? new Response("rate limited", { status: 429, headers: { "retry-after": "0.001" } }) : new Response('{"ok":true}', { status: 200 });
  });
  assert.deepEqual(retryPayload, { ok: true });
  assert.equal(attempts, 2, "429 deve respeitar backoff e repetir a chamada");
  attempts = 0;
  await assert.rejects(() => requestSourceJson(new URL("https://example.test/jobs"), async () => {
    attempts += 1;
    return new Response("unauthorized", { status: 401 });
  }), /HTTP 401/);
  assert.equal(attempts, 1, "401 não deve entrar em retry automático");

  const batch = await fetchCareerSources();
  const successful = batch.results.filter((source) => source.status === "SUCCESS");
  assert.ok(successful.length >= 2, `esperadas pelo menos duas fontes reais operacionais; disponíveis: ${successful.length}`);
  assert.ok(batch.results.some((source) => source.sourceKey === "CODERIO_LEVER" && source.status === "SUCCESS"), "Lever/Coderio precisa responder como fonte ativa");
  assert.ok(batch.results.some((source) => source.sourceKey === "WE_WORK_REMOTELY" && source.status === "SUCCESS"), "RSS WWR precisa responder como fonte ativa");
  assert.equal(new Set(batch.jobs.map((job) => `${job.sourceKey}:${job.externalId}`)).size, batch.jobs.length, "deduplicação por fonte e id precisa ser estável");
  for (const source of successful) {
    const jobs = batch.jobs.filter((job) => job.sourceKey === source.sourceKey);
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every((job) => /^https:\/\//.test(job.url) && job.attributionUrl.startsWith("https://")));
  }
  const engineering = batch.jobs.filter(isRelevantEngineeringJob);
  const eligibility = engineering.reduce<Record<string, number>>((counts, job) => {
    const status = assessJobEligibility(job, ["BR"]).status;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({
    liveSources: batch.results.map(({ sourceKey, mode, status, found, error }) => ({ sourceKey, mode, status, found, ...(error ? { error } : {}) })),
    totalLiveJobs: batch.jobs.length,
    matchingEngineeringJobs: engineering.length,
    brazilEligibility: eligibility,
    retrySimulation: "429 retry passed; 401 stopped without retry",
    databaseWrites: 0,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falha no teste de fontes.");
  process.exitCode = 1;
});
