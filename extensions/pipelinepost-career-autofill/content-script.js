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
    await fetch(`${session.apiBase}/api/career/browser-executor`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ state, reason, evidence }) });
  };
  const labelFor = (element) => {
    const byFor = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : "";
    return key(byFor || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.closest("label")?.textContent || element.name || "");
  };
  const answerFor = (answers, label) => {
    const rows = Array.isArray(answers) ? answers : Object.entries(answers ?? {}).map(([question, answer]) => ({ question, answer }));
    const found = rows.find((row) => label.includes(key(row.question)) || key(row.question).includes(label));
    return found?.answer;
  };
  const setValue = (element, value) => {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const asFile = (base64, filename) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new File([bytes], filename, { type: "application/pdf" });
  };
  const attach = (input, document) => {
    const transfer = new DataTransfer(); transfer.items.add(asFile(document.base64, document.filename)); input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const captchaPresent = () => Boolean(document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], [class*='captcha' i], [id*='captcha' i]"));
  const confirmationText = () => key(document.body?.innerText).match(/application (submitted|received)|thank you for applying|candidatura (enviada|recebida)|obrigado por se candidatar/)?.[0] ?? "";
  const run = async () => {
    const session = await chrome.runtime.sendMessage({ type: "PIPELINEPOST_GET_AUTHORIZATION" });
    if (!session || normalized(session.destinationUrl) !== normalized(location.href)) return;
    try {
      if (captchaPresent()) { await report(session, "NEEDS_ACTION", "CAPTCHA detectado; conclua-o manualmente no portal.", { url: location.href, reason: "CAPTCHA" }); return; }
      const response = await fetch(`${session.apiBase}/api/career/browser-executor`, { headers: { Authorization: `Bearer ${session.token}` }, cache: "no-store" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Pacote indisponível.");
      const missing = [];
      for (const element of document.querySelectorAll("input, textarea, select")) {
        if (element.disabled || element.type === "hidden") continue;
        const label = labelFor(element);
        if (element.type === "file") {
          if (/resume|curriculo|cv\b/.test(label)) attach(element, payload.documents.resume);
          else if (/cover|carta/.test(label)) attach(element, payload.documents.coverLetter);
          else if (element.required) missing.push(`Anexo: ${label || "não identificado"}`);
          continue;
        }
        const answer = answerFor(payload.answers, label);
        if (answer === undefined || answer === null || answer === "") { if (element.required) missing.push(label || "campo obrigatório não identificado"); continue; }
        if (element.tagName === "SELECT") { const option = [...element.options].find((item) => key(item.textContent) === key(answer) || key(item.value) === key(answer)); if (option) setValue(element, option.value); else if (element.required) missing.push(label); }
        else if (element.type === "checkbox" || element.type === "radio") { if (String(answer).toLowerCase() === "true" || key(answer) === key(element.value)) element.click(); }
        else setValue(element, String(answer));
      }
      if (missing.length) { await report(session, "NEEDS_ACTION", `Campos obrigatórios sem resposta aprovada: ${missing.slice(0, 6).join(", ")}`, { url: location.href, missing }); return; }
      await report(session, "BROWSER_FILLED", "Campos e anexos preenchidos pela extensão.", { url: location.href, packageHash: payload.packageHash });
      if (captchaPresent()) { await report(session, "NEEDS_ACTION", "CAPTCHA detectado após o preenchimento.", { url: location.href, reason: "CAPTCHA" }); return; }
      const submit = [...document.querySelectorAll("button, input[type='submit']")].find((item) => /submit|apply|enviar|candidatar/.test(key(item.textContent || item.value || item.getAttribute("aria-label"))));
      if (!submit) { await report(session, "NEEDS_ACTION", "Botão de envio não identificado com segurança.", { url: location.href }); return; }
      await report(session, "BROWSER_SUBMITTING", "A extensão iniciou o envio aprovado.", { url: location.href });
      submit.click();
      for (let i = 0; i < 20; i += 1) { await sleep(1000); const receipt = confirmationText(); if (receipt) { await report(session, "CONFIRMED", "O portal exibiu confirmação de candidatura.", { url: location.href, receipt }); await chrome.runtime.sendMessage({ type: "PIPELINEPOST_CLEAR_AUTHORIZATION" }); return; } if (captchaPresent()) { await report(session, "NEEDS_ACTION", "O portal solicitou CAPTCHA após o envio.", { url: location.href, reason: "CAPTCHA_AFTER_SUBMIT" }); return; } }
      await report(session, "UNCERTAIN", "O envio foi acionado, mas a página não apresentou confirmação verificável em 20 segundos.", { url: location.href });
    } catch (error) { await report(session, "NEEDS_ACTION", String(error?.message ?? error).slice(0, 400), { url: location.href, reason: "EXECUTOR_ERROR" }).catch(() => {}); }
  };
  void run();
})();
