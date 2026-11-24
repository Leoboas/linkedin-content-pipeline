import { chromium } from "playwright-core";

const browserPath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseURL = process.env.CAREER_UI_TEST_URL || "http://127.0.0.1:3151";
let authorized = false;
let postPayload;

const application = () => ({
  id: "00000000-0000-4000-8000-000000000001", status: "SAVED", preparationStatus: "READY_FOR_REVIEW", notes: null,
  recruiterContact: null, submissionEvidence: null, authorizedResume: { originalName: "synthetic-resume.pdf", version: "v2", language: "EN" },
  job: { id: "00000000-0000-4000-8000-000000000002", title: "Synthetic Backend Engineer", company: "Controlled Portal", location: "Remote", url: "https://jobs.lever.co/control/00000000-0000-4000-8000-000000000003", score: 88, rationale: "Synthetic browser test", description: "Controlled test vacancy" },
  kits: [{ id: "00000000-0000-4000-8000-000000000004", version: 2, language: "EN", coverLetter: "Controlled cover letter.", reviewStatus: "NEEDS_REVIEW", documentSha256: "test", createdAt: new Date().toISOString(), requiredConfirmations: [], unverifiedRequirements: [] }],
  events: [], submissions: authorized ? [{ id: "00000000-0000-4000-8000-000000000005", state: "QUEUED", reason: null, portalReceipt: null }] : [],
});

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage();
await page.route("**/api/career/matches", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ matches: [] }) }));
await page.route("**/api/career/applications", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ applications: [application()] }) }));
await page.route("**/api/career/application-kits/00000000-0000-4000-8000-000000000004/submission", async (route) => {
  if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ company: "Controlled Portal", destinationUrl: application().job.url, coverLetter: "Controlled cover letter.", version: 2, dryRun: true, form: { schemaHash: "controlled", title: "Synthetic Backend Engineer", board: "control", fields: [
    { key: "personal:email", label: "Email", description: "", type: "text", required: true, options: [] },
    { key: "custom:documents:resume", label: "Resume", description: "", type: "file-upload", required: true, options: [] },
    { key: "custom:documents:cover", label: "Cover letter", description: "", type: "file-upload", required: true, options: [] },
  ] } }) });
  postPayload = route.request().postDataJSON(); authorized = true;
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000005", state: "QUEUED" }) });
});

await page.goto(`${baseURL}/career/applications`);
await page.locator('input[autocomplete="username"]').fill("ui@test");
await page.locator('input[autocomplete="current-password"]').fill("synthetic-password");
await page.getByRole("button", { name: /entrar/i }).click();
await page.getByRole("button", { name: /revisar para envio automático/i }).click();
await page.getByLabel("Email *").fill("candidate@example.test");
const selects = page.locator("select.admin-input");
await selects.nth(0).selectOption("$resume");
await selects.nth(1).selectOption("$coverLetter");
await page.getByRole("button", { name: /autorizar teste sem envio/i }).click();
await page.getByText(/envio: na fila/i).waitFor();
if (!postPayload || postPayload.formHash !== "controlled" || postPayload.answers["custom:documents:resume"] !== "$resume" || postPayload.answers["custom:documents:cover"] !== "$coverLetter") throw new Error("The approved payload did not contain the reviewed form and attachments.");
await browser.close();
console.log("Career submission UI: review, approved answers, attachments and queued state passed.");
