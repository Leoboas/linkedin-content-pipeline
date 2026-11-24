import { createHash } from "node:crypto";

/** The Lever API is an employer-scoped integration. Never send candidate data to a URL supplied by a job listing. */
export type LeverField = { key: string; label: string; description: string; type: string; required: boolean; options: string[] };
export type LeverForm = { postingId: string; title: string; board: string; fields: LeverField[]; schemaHash: string };
export type LeverAnswers = Record<string, string | string[]>;
type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

function object(value: unknown): Json { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }

export function parseLeverDestination(url: string): { board: string; postingId: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Link de vaga inválido."); }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parsed.protocol !== "https:" || parsed.hostname !== "jobs.lever.co" || parsed.username || parsed.password || parts.length < 2 || parts.length > 3 || (parts[2] && parts[2] !== "apply") || !/^[\w-]+$/u.test(parts[0]) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(parts[1])) {
    throw new Error("Somente links oficiais de vagas Lever são compatíveis.");
  }
  return { board: parts[0].toLowerCase(), postingId: parts[1].toLowerCase() };
}

function fieldsFromForm(raw: Json): LeverField[] {
  const known = new Set(["id", "text", "personalInformation", "urls", "customQuestions", "eeoQuestions"]);
  if (Object.entries(raw).some(([key, value]) => !known.has(key) && value !== null && value !== undefined && value !== false && value !== "" && !(Array.isArray(value) && value.length === 0))) throw new Error("O formulário contém informações ou declarações que ainda não podem ser revisadas automaticamente.");
  const fields: LeverField[] = [];
  const add = (key: string, value: unknown) => {
    const field = object(value);
    if (!text(field.type) || !text(field.text)) throw new Error("O formulário Lever contém um campo não reconhecido.");
    const type = text(field.type);
    if (!["text", "textarea", "dropdown", "multiple-choice", "multiple-select", "file-upload"].includes(type)) throw new Error("O formulário contém um tipo de campo ainda não compatível.");
    fields.push({ key, label: text(field.text), description: text(field.description), type, required: field.required === true, options: array(field.options).map((item) => text(object(item).text)).filter(Boolean) });
  };
  for (const item of array(raw.personalInformation)) { const field = object(item); if (!text(field.name)) throw new Error("Campo pessoal sem identificador."); add(`personal:${text(field.name)}`, field); }
  for (const item of array(raw.urls)) { const field = object(item); if (!text(field.name)) throw new Error("Campo de URL sem identificador."); add(`url:${text(field.name)}`, field); }
  for (const item of array(raw.customQuestions)) {
    const group = object(item); if (!text(group.id)) throw new Error("Grupo de perguntas sem identificador.");
    array(group.fields).forEach((field, index) => { const value = object(field); add(`custom:${text(group.id)}:${text(value.id) || index}`, field); });
  }
  for (const [key, value] of Object.entries(object(raw.eeoQuestions))) add(`eeo:${key}`, value);
  if (new Set(fields.map((field) => field.key)).size !== fields.length) throw new Error("O formulário contém identificadores duplicados.");
  return fields;
}

function schemaHash(postingId: string, fields: LeverField[]): string {
  return createHash("sha256").update(JSON.stringify({ postingId, fields })).digest("hex");
}

export class LeverClient {
  private readonly base: string;
  private readonly auth: string;
  constructor(private readonly apiKey: string, private readonly fetcher: Fetcher = fetch, sandbox = false) {
    if (!apiKey.trim()) throw new Error("A chave autorizada da API Lever não está configurada.");
    this.base = sandbox ? "https://api.sandbox.lever.co/v1" : "https://api.lever.co/v1";
    this.auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(`${this.base}${path}`, { ...init, headers: { Authorization: this.auth, ...init.headers }, signal: AbortSignal.timeout(30000), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error(`Lever recusou a operação (HTTP ${response.status}).`);
    return response.json();
  }
  async inspect(jobUrl: string, expectedTitle: string): Promise<LeverForm> {
    const target = parseLeverDestination(jobUrl);
    const posting = object(object(await this.request(`/postings/${target.postingId}`)).data);
    const officialUrl = text(object(posting.urls).apply) || text(object(posting.urls).show);
    const official = parseLeverDestination(officialUrl);
    if (text(posting.id).toLowerCase() !== target.postingId || official.postingId !== target.postingId || official.board !== target.board || text(posting.state) !== "published" || text(posting.text).trim() !== expectedTitle.trim()) throw new Error("A vaga retornada pelo portal não corresponde ao destino ou ao cargo revisado.");
    const form = object(object(await this.request(`/postings/${target.postingId}/apply`)).data);
    // The apply-form identifier is distinct from the posting identifier. The
    // posting endpoint above is the identity check; this only verifies form data.
    if (!text(form.id) || text(form.text).trim() !== expectedTitle.trim()) throw new Error("O formulário não corresponde à vaga.");
    const fields = fieldsFromForm(form);
    return { ...target, title: expectedTitle, fields, schemaHash: schemaHash(target.postingId, fields) };
  }
  async upload(bytes: Buffer, filename: string): Promise<string> {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), filename);
    const data = object(object(await this.request("/uploads", { method: "POST", body })).data);
    const uri = text(data.uri);
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:" || parsed.origin !== this.base.slice(0, -3) || !parsed.pathname.startsWith("/v1/uploads/")) throw new Error("O portal não confirmou o upload de um anexo válido.");
    return uri;
  }
  /** Only call once after a durable SUBMITTING transition. A failure may mean the portal received the request. */
  async submit(form: LeverForm, answers: LeverAnswers, attachments: Record<string, string>): Promise<string> {
    const payload = buildLeverPayload(form, answers, attachments);
    const result = object(object(await this.request(`/postings/${form.postingId}/apply?send_confirmation_email=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).data);
    const id = text(result.applicationId);
    if (!id) throw new Error("O portal não retornou identificador de confirmação.");
    return id;
  }
}

export function validateLeverAnswers(form: LeverForm, answers: LeverAnswers): void {
  const allowed = new Set(form.fields.map((field) => field.key));
  if (Object.keys(answers).some((key) => !allowed.has(key))) throw new Error("A resposta contém campo que não pertence ao formulário revisado.");
  for (const field of form.fields) {
    const value = answers[field.key];
    const selected = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
    if (field.required && !selected.length) throw new Error(`Preencha o campo obrigatório: ${field.label}.`);
    if (field.type === "file-upload" && selected.some((v) => !["$resume", "$coverLetter"].includes(v))) throw new Error(`Selecione um documento válido para ${field.label}.`);
    if (field.type === "multiple-select" && value !== undefined && !Array.isArray(value)) throw new Error(`Selecione os valores de ${field.label}.`);
    if (field.type !== "multiple-select" && Array.isArray(value)) throw new Error(`Resposta inválida para ${field.label}.`);
    if (field.options.length && selected.some((v) => !field.options.includes(v))) throw new Error(`Opção inválida para ${field.label}.`);
  }
  const attachments = form.fields.filter((field) => field.type === "file-upload").map((field) => answers[field.key]);
  if (!attachments.includes("$resume") || !attachments.includes("$coverLetter")) throw new Error("O formulário precisa aceitar currículo e carta em campos de arquivo separados.");
}

export function buildLeverPayload(form: LeverForm, answers: LeverAnswers, attachments: Record<string, string>): Json {
  validateLeverAnswers(form, answers);
  const personalInformation: Json[] = [], urls: Json[] = [];
  const customQuestions: Array<{ id: string; fields: Json[] }> = [];
  const eeoResponses: Json = {};
  for (const field of form.fields) {
    let value: string | string[] | null = answers[field.key] ?? null;
    if (typeof value === "string" && !value.trim()) value = null;
    if (field.type === "file-upload" && typeof value === "string") {
      value = attachments[value] ?? null;
      if (!value) throw new Error(`Anexo não confirmado: ${field.label}.`);
    }
    const [kind, id] = field.key.split(":");
    if (kind === "personal") personalInformation.push({ name: id, value });
    else if (kind === "url") urls.push({ name: id, value });
    else if (kind === "eeo") eeoResponses[id] = value;
    else if (kind === "custom") {
      let group = customQuestions.find((entry) => entry.id === id);
      if (!group) { group = { id, fields: [] }; customQuestions.push(group); }
      group.fields.push({ value });
    }
  }
  return { personalInformation, urls, customQuestions, eeoResponses };
}
