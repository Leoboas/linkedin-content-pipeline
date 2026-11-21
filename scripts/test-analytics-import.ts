import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { metricAvailabilityForFields, measurementWindowLateness, nextDueMeasurementWindow, parseOptionalNonNegativeInteger, snapshotIdempotencyKey } from "../src/lib/analytics-data.ts";
import { analyticsImportIdempotencyKey, parseAnalyticsFile, parseImportedMetric, resolveAnalyticsPostByLinkedInId, suggestAnalyticsColumnMapping } from "../src/lib/analytics-import.ts";

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeXlsxFixture(): Buffer {
  const files = [
    ["xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Analytics" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/sharedStrings.xml", "<sst><si><t>Post ID</t></si><si><t>Impressions</t></si><si><t>Post Title</t></si><si><t>Activity 123</t></si><si><t>Engineering, data</t></si></sst>"],
    ["xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>0</v></c><c r="C2" t="s"><v>4</v></c></row></sheetData></worksheet>'],
  ] as const;
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, source] of files) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(source);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(crc, 14); localHeader.writeUInt32LE(compressed.length, 18); localHeader.writeUInt32LE(data.length, 22); localHeader.writeUInt16LE(nameBuffer.length, 26);
    local.push(localHeader, nameBuffer, compressed);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); centralHeader.writeUInt16LE(20, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(crc, 16); centralHeader.writeUInt32LE(compressed.length, 20); centralHeader.writeUInt32LE(data.length, 24); centralHeader.writeUInt16LE(nameBuffer.length, 28); centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

const csv = Buffer.from('"Post ID","Post Title",Impressions,Reactions,Comments,Report date\r\n"urn:li:share:123","Engineering, data",534,3,0,2026-11-18\r\n', "utf8");
const parsedCsv = parseAnalyticsFile(csv, "linkedin-export.csv");
assert.deepEqual(parsedCsv.headers, ["Post ID", "Post Title", "Impressions", "Reactions", "Comments", "Report date"]);
assert.equal(parsedCsv.rows[0]?.values["Post Title"], "Engineering, data");
assert.equal(parsedCsv.rows[0]?.values.Comments, "0");
assert.equal(suggestAnalyticsColumnMapping(parsedCsv.headers).linkedinPostId, "Post ID");
assert.equal(suggestAnalyticsColumnMapping(parsedCsv.headers).impressions, "Impressions");
assert.equal(parseImportedMetric("1.234"), 1234);
assert.equal(parseImportedMetric("1,234,567"), 1234567);
assert.equal(parseImportedMetric("45,5%", true), 45.5);
assert.equal(parseImportedMetric(""), null);
assert.throws(() => parseImportedMetric("-1"));
assert.throws(() => parseAnalyticsFile(Buffer.from("bad"), "invalid.txt"));
assert.throws(() => parseAnalyticsFile(Buffer.from("only-header"), "bad.csv"));
const posts = [{ id: "post-a", linkedinPostId: "urn:li:share:123", title: "Different title" }, { id: "post-b", linkedinPostId: null, title: "Engineering, data" }];
assert.equal(resolveAnalyticsPostByLinkedInId("urn:li:share:123", posts)?.id, "post-a");
assert.equal(resolveAnalyticsPostByLinkedInId("Engineering, data", posts), null, "title matching must not auto-assign a post");
const importKey = analyticsImportIdempotencyKey({ fileSha256: "digest", rowNumber: 2 });
assert.equal(importKey, analyticsImportIdempotencyKey({ fileSha256: "digest", rowNumber: 2 }));
assert.notEqual(importKey, analyticsImportIdempotencyKey({ fileSha256: "other", rowNumber: 2 }));

const parsedXlsx = parseAnalyticsFile(makeXlsxFixture(), "fixture.xlsx");
assert.deepEqual(parsedXlsx.headers, ["Post ID", "Impressions", "Post Title"]);
assert.equal(parsedXlsx.rows[0]?.values.Impressions, "0");
assert.equal(parsedXlsx.rows[0]?.values["Post Title"], "Engineering, data");
assert.equal(parseOptionalNonNegativeInteger("").value, null);
assert.equal(parseOptionalNonNegativeInteger("0").value, 0);
assert.equal(metricAvailabilityForFields({ impressions: 0, comments: null }, ["impressions", "comments"]), "PARTIAL");
assert.equal(metricAvailabilityForFields({ impressions: 0 }, ["impressions"]), "AVAILABLE");
assert.equal(metricAvailabilityForFields({ impressions: null }, ["impressions"]), "UNAVAILABLE");
assert.equal(nextDueMeasurementWindow(25, new Set()), "24H");
assert.equal(nextDueMeasurementWindow(73, new Set(["24H"])), "72H");
assert.equal(nextDueMeasurementWindow(169, new Set(["24H", "72H"])), "7D");
assert.equal(nextDueMeasurementWindow(100, new Set(["24H", "72H"])), null);
assert.equal(measurementWindowLateness("24H", 26), 2);
assert.equal(measurementWindowLateness("7D", 168), 0);
assert.equal(measurementWindowLateness("LIFETIME", 500), null);
assert.equal(snapshotIdempotencyKey("post", "MANUAL", "7D", new Date("2026-11-18T02:00:00Z")), snapshotIdempotencyKey("post", "MANUAL", "7D", new Date("2026-11-18T22:00:00Z")));
console.log("Analytics import acceptance passed: CSV/XLSX fixtures, exact-ID post association, no title guessing, invalid files, zero vs NULL, percent parsing, D+1/D+3/D+7 windows and idempotency.");
