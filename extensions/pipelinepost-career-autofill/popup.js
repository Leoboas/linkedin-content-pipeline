const key = "pipelinepost.authorizedSubmission";
const state = document.querySelector("#state");
chrome.storage.session.get(key).then((value) => { const item = value[key]; state.textContent = item ? `Autorização ativa: ${item.submissionId.slice(0, 8)}…` : "Sem candidatura autorizada."; });
document.querySelector("#clear").addEventListener("click", () => chrome.storage.session.remove(key).then(() => { state.textContent = "Autorização local removida."; }));
