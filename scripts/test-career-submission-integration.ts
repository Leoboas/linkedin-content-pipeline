import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfirmedDevelopmentDatabase } from "./lib/confirmed-dev-database";
import { assertEmptyApplicationTables, assertOnlyDeterministicMigrationSeeds } from "./lib/isolated-db-assertions";
import type { LeverForm } from "../src/lib/lever-application";

async function main() {
  const target = loadConfirmedDevelopmentDatabase();
  const { prisma } = await import("../src/lib/prisma");
  const { authorizeSubmission, processSubmission } = await import("../src/lib/career-submission");
  const profileId = randomUUID();
  const jobIds: string[] = [];
  const applicationIds: string[] = [];
  const kitIds: string[] = [];
  const form: LeverForm = { postingId: "f2f01e16-27f8-4711-a728-7d49499795a0", title: "Synthetic Engineer", board: "synthetic", schemaHash: "a".repeat(64), fields: [
    { key: "personal:fullName", label: "Name", description: "", type: "text", required: true, options: [] },
    { key: "personal:resume", label: "Resume", description: "", type: "file-upload", required: true, options: [] },
    { key: "personal:letter", label: "Cover", description: "", type: "file-upload", required: true, options: [] },
  ] };
  const answers = { "personal:fullName": "Synthetic Candidate", "personal:resume": "$resume", "personal:letter": "$coverLetter" };
  let uploads = 0, sends = 0, mode: "ok" | "upload-error" | "uncertain" | "changed" = "ok";
  const portal = {
    inspect: async () => mode === "changed" ? { ...form, schemaHash: "b".repeat(64) } : form,
    upload: async () => { if (mode === "upload-error") throw new Error("Attachment failed"); return `https://api.lever.co/v1/uploads/${++uploads}`; },
    submit: async () => { sends++; if (mode === "uncertain") throw new Error("response lost"); return `receipt-${sends}`; },
  };
  async function fixture(reviewStatus: "NEEDS_REVIEW" | "APPROVED" = "NEEDS_REVIEW") {
    const jobId = randomUUID(), applicationId = randomUUID(), kitId = randomUUID();
    jobIds.push(jobId); applicationIds.push(applicationId); kitIds.push(kitId);
    await prisma.jobListing.create({ data: { id: jobId, source: "AUTHORIZED_FEED", externalId: `test-${jobId}`, title: form.title, url: `https://jobs.lever.co/synthetic/${form.postingId}/apply`, description: "Synthetic job." } });
    await prisma.jobApplication.create({ data: { id: applicationId, profileId, jobId, preparationStatus: "READY_FOR_REVIEW" } });
    await prisma.applicationKit.create({ data: { id: kitId, applicationId, requestKey: `test-${kitId}`, version: 1, language: "EN", tailoredResume: { headline: "Synthetic Engineer", summary: "Synthetic profile" }, coverLetter: "Synthetic cover letter.", reviewStatus } });
    return { kitId, applicationId };
  }
  try {
    await assertOnlyDeterministicMigrationSeeds(prisma);
    await assertEmptyApplicationTables(prisma, { allowPopulatedTables: ["MonitoredCompany", "NetworkingTopic"] });
    await prisma.candidateProfile.create({ data: { id: profileId, name: "Synthetic Candidate", headline: "Synthetic", about: "Synthetic", skills: [], targetTitles: [] } });
    const a = await fixture();
    const outcomes = await Promise.allSettled([authorizeSubmission(a.kitId, profileId, form.schemaHash, answers, portal), authorizeSubmission(a.kitId, profileId, form.schemaHash, answers, portal)]);
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
    const [first, duplicate] = outcomes.map((outcome) => { if (outcome.status !== "fulfilled") throw new Error("Approval failed"); return outcome.value; });
    assert.equal(first.id, duplicate.id, "double approval should converge");
    assert.equal((await processSubmission(first.id, portal)).status, "CONFIRMED");
    assert.equal((await processSubmission(first.id, portal)).status, "ALREADY_CLAIMED");
    assert.equal(sends, 1, "repeated delivery must not submit twice");
    const saved = await prisma.applicationSubmission.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(saved.portalReceipt, "receipt-1");
    assert.equal((await prisma.jobApplication.findUniqueOrThrow({ where: { id: a.applicationId } })).status, "APPLIED");
    const old = await fixture("APPROVED");
    await assert.rejects(() => authorizeSubmission(old.kitId, profileId, form.schemaHash, answers, portal), /mudou/u);
    const b = await fixture();
    const interrupted = await authorizeSubmission(b.kitId, profileId, form.schemaHash, answers, portal);
    mode = "upload-error";
    assert.equal((await processSubmission(interrupted.id, portal)).status, "NEEDS_ACTION");
    assert.equal(sends, 1);
    mode = "ok";
    const c = await fixture();
    const lost = await authorizeSubmission(c.kitId, profileId, form.schemaHash, answers, portal);
    mode = "uncertain";
    assert.equal((await processSubmission(lost.id, portal)).status, "UNCERTAIN");
    assert.equal((await processSubmission(lost.id, portal)).status, "ALREADY_CLAIMED");
    assert.equal(sends, 2, "uncertain submission must not be repeated");
    mode = "ok";
    const d = await fixture();
    const changed = await authorizeSubmission(d.kitId, profileId, form.schemaHash, answers, portal);
    mode = "changed";
    assert.equal((await processSubmission(changed.id, portal)).status, "NEEDS_ACTION");
    assert.equal(sends, 2, "changed form must not be submitted");
    mode = "ok";
    process.env.LEVER_SANDBOX = "true";
    process.env.CAREER_SUBMISSION_DRY_RUN = "true";
    const e = await fixture();
    const testOnly = await authorizeSubmission(e.kitId, profileId, form.schemaHash, answers, portal);
    assert.equal((await processSubmission(testOnly.id, portal)).status, "TEST_PASSED");
    assert.equal((await prisma.jobApplication.findUniqueOrThrow({ where: { id: e.applicationId } })).status, "SAVED");
    assert.equal(sends, 2, "dry-run must stop before submission");
    console.log(`Isolated ${target.provider}: approval, idempotency, confirmation, old approvals, changed form, attachment failure and uncertain delivery passed.`);
  } finally {
    // Exact synthetic UUIDs created by this test, after confirming the target and empty application tables.
    await prisma.applicationSubmission.deleteMany({ where: { kitId: { in: kitIds } } });
    await prisma.jobApplicationEvent.deleteMany({ where: { applicationId: { in: applicationIds } } });
    await prisma.applicationKit.deleteMany({ where: { id: { in: kitIds } } });
    await prisma.jobApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.jobListing.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.candidateProfile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  }
}

void main();
