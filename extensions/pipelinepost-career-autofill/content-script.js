(() => {
  const dashboard = location.hostname.endsWith("vercel.app") && location.pathname.startsWith("/career");
  if (dashboard) {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== "PIPELINEPOST_BROWSER_APPLICATION_AUTHORIZED") return;
      chrome.runtime.sendMessage({ type: "PIPELINEPOST_STORE_AUTHORIZATION", payload: event.data.payload });
    });
    return;
  }

  const normalized = (url) => { try { const value = new URL(url); return `${value.origin}${value.pathname}`.replace(/\/$/, ""); } catch { return ""; } };
  const key = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = async (session, state, reason, evidence = {}) => {
    const response = await fetch(`${session.apiBase}/api/career/browser-executor`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ state, reason, evidence }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Não foi possível registrar a etapa no painel.");
  };
  const questionFor = (element) => {
    const container = element.closest(".application-question, .application-additional, .application-field, fieldset, .form-group");
    const leverLabel = container?.querySelector(".application-label .text, .application-label, legend");
    const byFor = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : "";
    return key(leverLabel?.textContent || byFor || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.closest("label")?.textContent || element.name || "").replace(/^\d+\s+/, "");
  };
  const choiceFor = (element) => key(element.closest("label")?.textContent || element.getAttribute("aria-label") || element.value || "");
  const answerRows = (answers) => Array.isArray(answers) ? answers : Object.entries(answers ?? {}).map(([question, answer]) => ({ question, answer }));
  const candidateAnswer = (candidate, label) => {
    if (/\b(full name|nome completo|nombre completo|your name)\b/.test(label)) return candidate.name;
    if (/\b(e mail|email|correo)\b/.test(label)) return candidate.email;
    if (/\b(phone|telephone|telefone|celular|movil)\b/.test(label)) return candidate.phone;
    if (/\b(linkedin)\b/.test(label)) return candidate.linkedinUrl;
    if (/\b(github)\b/.test(label)) return candidate.githubUrl;
    if (/\b(portfolio|website|site pessoal)\b/.test(label)) return candidate.portfolioUrl;
    if (/\b(location|ubicacion|localizacao)\b/.test(label)) return candidate.location;
    return undefined;
  };
  const answerFor = (payload, label) => {
    const found = answerRows(payload.answers).find((row) => {
      const question = key(row.question).replace(/^\d+\s+/, "");
      return question.length >= 5 && (label.includes(question) || question.includes(label));
    });
    return found?.answer ?? candidateAnswer(payload.candidate ?? {}, label);
  };
  const setValue = (element, value) => {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const asFile = (base64, filename) => new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], filename, { type: "application/pdf" });
  const attach = (input, file) => { const transfer = new DataTransfer(); transfer.items.add(asFile(file.base64, file.filename)); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true })); };
  const captchaPresent = () => Boolean(document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], [class*='captcha' i], [id*='captcha' i]"));
  const confirmationText = () => key(document.body?.innerText).match(/application (submitted|received)|thank you for applying|candidatura (enviada|recebida)|obrigado por se candidatar/)?.[0] ?? "";
  const submitButton = () => [...document.querySelectorAll("button, input[type='submit']")].find((item) => /submit|apply|enviar|candidatar/.test(key(item.textContent || item.value || item.getAttribute("aria-label"))));
  const waitForForm = async () => { for (let i = 0; i < 24; i += 1) { if (document.querySelector("form input, form textarea, form select")) return true; await sleep(500); } return false; };
  const observeCompletion = (session) => {
    let submittingReported = false;
    const confirm = async () => {
      const receipt = confirmationText();
      if (!receipt) return;
      await report(session, "CONFIRMED", "O portal exibiu confirmação de candidatura.", { url: location.href, receipt });
      await chrome.runtime.sendMessage({ type: "PIPELINEPOST_CLEAR_AUTHORIZATION" });
      observer.disconnect();
    };
    const observer = new MutationObserver(() => { void confirm().catch(() => {}); });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button, input[type='submit']");
      if (button && button === submitButton() && !submittingReported) {
        submittingReported = true;
        void report(session, "BROWSER_SUBMITTING", "Envio iniciado manualmente após a pendência do portal.", { url: location.href }).catch(() => {});
      }
    }, true);
    void confirm().catch(() => {});
  };
  const run = async () => {
    const session = await chrome.runtime.sendMessage({ type: "PIPELINEPOST_GET_AUTHORIZATION" });
    if (!session || normalized(session.destinationUrl) !== normalized(location.href)) return;
    try {
      if (!(await waitForForm())) throw new Error("O portal não carregou campos de formulário a tempo.");
      const response = await fetch(`${session.apiBase}/api/career/browser-executor`, { headers: { Authorization: `Bearer ${session.token}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Pacote indisponível.");
      const missing = new Set();
      for (const element of document.querySelectorAll("input, textarea, select")) {
        if (element.disabled || element.type === "hidden") continue;
        const label = questionFor(element);
        if (element.type === "file") {
          if (/resume|curriculo|curriculum|cv\b/.test(label)) attach(element, payload.documents.resume);
          else if (/cover|carta/.test(label)) attach(element, payload.documents.coverLetter);
          else if (element.required) missing.add(`Anexo: ${label || "não identificado"}`);
          continue;
        }
        const answer = answerFor(payload, label);
        if (answer === undefined || answer === null || answer === "") { if (element.required) missing.add(label || "campo obrigatório não identificado"); continue; }
        if (element.tagName === "SELECT") {
          const option = [...element.options].find((item) => key(item.textContent) === key(answer) || key(item.value) === key(answer));
          if (option) setValue(element, option.value); else if (element.required) missing.add(label);
        } else if (element.type === "checkbox" || element.type === "radio") {
          const value = key(answer); const choice = choiceFor(element);
          const affirmative = value === "true" && /yes|sim|si/.test(choice);
          if ((value && (value === choice || choice.includes(value) || value.includes(choice))) || affirmative) { if (!element.checked) element.click(); }
          else if (element.required) missing.add(label || "opção obrigatória");
        } else setValue(element, String(answer));
      }
      if (missing.size) { await report(session, "NEEDS_ACTION", `Campos obrigatórios sem resposta aprovada: ${[...missing].slice(0, 6).join(", ")}`, { url: location.href, missing: [...missing] }); return; }
      await report(session, "BROWSER_FILLED", "Campos e anexos preenchidos pela extensão.", { url: location.href, packageHash: payload.packageHash });
      if (captchaPresent()) { await report(session, "NEEDS_ACTION", "Formulário preenchido; conclua o CAPTCHA manualmente e envie no portal.", { url: location.href, reason: "CAPTCHA_AFTER_FILL" }); observeCompletion(session); return; }
      const submit = submitButton();
      if (!submit) { await report(session, "NEEDS_ACTION", "Botão de envio não identificado com segurança.", { url: location.href }); return; }
      await report(session, "BROWSER_SUBMITTING", "A extensão iniciou o envio aprovado.", { url: location.href });
      submit.click();
      observeCompletion(session);
      for (let i = 0; i < 20; i += 1) { await sleep(1000); if (confirmationText()) return; }
      await report(session, "UNCERTAIN", "O envio foi acionado, mas a página não apresentou confirmação verificável em 20 segundos.", { url: location.href });
    } catch (error) {
      await report(session, "NEEDS_ACTION", String(error?.message ?? error).slice(0, 400), { url: location.href, reason: "EXECUTOR_ERROR" }).catch(() => {});
    }
  };
  void run();
})();
