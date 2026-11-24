import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getResumeMetadataByName } from "../config/authorized-resumes.ts";
import { extractResumeText } from "../src/lib/resume-document-extractor.ts";
import { authorizedResumeStorageKey, authorizedResumeVersion, isCandidateResumeKey, resumeMatchesBaseKey } from "../src/lib/authorized-resume-versioning.ts";

const baseKey = "data-engineering-en-v2";
const firstHash = "a".repeat(64);
const secondHash = "b".repeat(64);
assert.equal(getResumeMetadataByName("Leonardo_Villas_Boas_Data_Engineer_EN_V2.docx")?.resumeKey, baseKey);
assert.equal(getResumeMetadataByName("Leonardo_Villas_Boas_Data_Engineer_EN_V2 (1).docx")?.resumeKey, baseKey);
assert.equal(getResumeMetadataByName("Leonardo_Villas_Boas_Resume_EN_TECH.pdf")?.referenceOnly, true);
assert.equal(authorizedResumeStorageKey(baseKey, firstHash, false), baseKey);
assert.equal(authorizedResumeStorageKey(baseKey, secondHash, true), `${baseKey}-vbbbbbbbbbbbb`);
assert.notEqual(authorizedResumeStorageKey(baseKey, firstHash, true), authorizedResumeStorageKey(baseKey, secondHash, true));
assert.equal(authorizedResumeVersion("V2", secondHash, true), "V2-bbbbbbbb");
assert.equal(isCandidateResumeKey("reference-tech-en-pdf"), false);
assert.equal(isCandidateResumeKey(baseKey), true);
assert.equal(resumeMatchesBaseKey(`${baseKey}-vbbbbbbbbbbbb`, baseKey), true);

async function main() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const fixtureLines = [
    "Synthetic Python backend resume. FastAPI PostgreSQL AWS.",
    "This text is only a parser regression fixture and contains no candidate data.",
    "It validates extraction of backend services, data pipelines, cloud architecture, tests,",
    "technical documentation, and engineering experience from a locally generated PDF.",
  ];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  fixtureLines.forEach((line, index) => page.drawText(line, {
    x: 40,
    y: 760 - index * 24,
    font,
    size: 12,
  }));
  const pdfBytes = Buffer.from(await pdf.save());
  const extracted = await extractResumeText(pdfBytes, "application/pdf");
  assert.match(extracted, /Synthetic Python backend resume/u);
  assert.match(extracted, /FastAPI PostgreSQL AWS/u);
  await assert.rejects(() => extractResumeText(Buffer.from("not a PDF"), "application/pdf"));
  console.log("resume library acceptance: filename aliases, immutable content-hash versions, reference isolation and private PDF text extraction passed using synthetic content.");
}

void main();
