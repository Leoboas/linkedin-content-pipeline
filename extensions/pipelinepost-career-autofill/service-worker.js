const SESSION_KEY = "pipelinepost.authorizedSubmission";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PIPELINEPOST_STORE_AUTHORIZATION") {
    chrome.storage.session.set({ [SESSION_KEY]: message.payload }).then(async () => {
      await chrome.tabs.create({ url: message.payload.destinationUrl, active: true });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  if (message?.type === "PIPELINEPOST_GET_AUTHORIZATION") {
    chrome.storage.session.get(SESSION_KEY).then((value) => sendResponse(value[SESSION_KEY] ?? null));
    return true;
  }
  if (message?.type === "PIPELINEPOST_CLEAR_AUTHORIZATION") {
    chrome.storage.session.remove(SESSION_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }
});
