import assert from "node:assert/strict";
import { LeverClient, buildLeverPayload, parseLeverDestination, validateLeverAnswers } from "../src/lib/lever-application";

const postingId = "f2f01e16-27f8-4711-a728-7d49499795a0";
const url = `https://jobs.lever.co/example/${postingId}/apply`;
const title = "Python Engineer";
const formData = { id: postingId, text: title, personalInformation: [
  { name: "fullName", text: "Name", type: "text", required: true },
  { name: "resume", text: "Resume", type: "file-upload", required: true },
  { name: "letter", text: "Cover letter", type: "file-upload", required: true },
], urls: [], customQuestions: [{ id: "group", fields: [{ id: "authorization", text: "Work authorization", type: "text", required: true }] }], eeoQuestions: {} };
let submissions = 0;
let uploads = 0;
const fakeFetch: typeof fetch = async (input, init) => {
  const target = String(input);
  if (target.endsWith(`/postings/${postingId}`)) return Response.json({ data: { id: postingId, text: title, state: "published", urls: { apply: url } } });
  if (target.endsWith(`/postings/${postingId}/apply`)) return Response.json({ data: formData });
  if (target.endsWith("/uploads")) { uploads++; return Response.json({ data: { uri: `https://api.lever.co/v1/uploads/file-${uploads}` } }); }
  if (target.endsWith("/apply?send_confirmation_email=true")) {
    submissions++;
    const body = JSON.parse(String(init?.body)) as { personalInformation: Array<{ name: string; value: string }> };
    assert.equal(body.personalInformation.find((field) => field.name === "resume")?.value, "https://api.lever.co/v1/uploads/file-1");
    assert.equal(body.personalInformation.find((field) => field.name === "letter")?.value, "https://api.lever.co/v1/uploads/file-2");
    return Response.json({ data: { applicationId: "sandbox-confirmation-id" } }, { status: 201 });
  }
  throw new Error(`Unexpected URL: ${target}`);
};

async function main() {
  assert.throws(() => parseLeverDestination(`https://jobs.lever.co.evil.example/example/${postingId}`));
  const client = new LeverClient("test-key", fakeFetch);
  const form = await client.inspect(url, title);
  const answers = { "personal:fullName": "Synthetic Candidate", "personal:resume": "$resume", "personal:letter": "$coverLetter", "custom:group:authorization": "Confirmed" };
  validateLeverAnswers(form, answers);
  assert.throws(() => validateLeverAnswers(form, { ...answers, "custom:group:authorization": "" }), /obrigatório/u);
  assert.throws(() => validateLeverAnswers(form, { ...answers, "personal:letter": "$resume" }), /carta/u);
  assert.equal(submissions, 0, "inspection and dry run must not submit");
  const resume = await client.upload(Buffer.from("synthetic resume"), "resume.pdf");
  const cover = await client.upload(Buffer.from("synthetic cover"), "cover.pdf");
  assert.deepEqual((buildLeverPayload(form, answers, { $resume: resume, $coverLetter: cover }).customQuestions as unknown[]).length, 1);
  assert.equal(submissions, 0, "preflight and uploads must not submit");
  assert.equal(await client.submit(form, answers, { $resume: resume, $coverLetter: cover }), "sandbox-confirmation-id");
  assert.equal(submissions, 1);
  await assert.rejects(() => client.inspect(url, "Wrong title"), /não corresponde/u);
  const uploadFailure = new LeverClient("test-key", async () => new Response(null, { status: 503 }));
  await assert.rejects(() => uploadFailure.upload(Buffer.from("synthetic"), "resume.pdf"), /503/u);
  console.log("Lever adapter: controlled destination, form, documents, dry-run boundary and confirmation passed.");
}

void main();
