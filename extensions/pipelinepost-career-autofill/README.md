# PipelinePost Career Autofill

Extensão assistida para Chrome. Ela recebe uma autorização efêmera do dashboard, abre a URL oficial, preenche apenas respostas e documentos daquele pacote aprovado e reporta o resultado ao Career CRM.

## Instalação local

1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação**.
3. Selecione esta pasta (`extensions/pipelinepost-career-autofill`).
4. Mantenha a extensão ativa, abra uma candidatura em **Pronta para revisão** e clique em **Aprovar e autorizar preenchimento no Chrome**.

Ela não tenta resolver CAPTCHA/MFA, não armazena documentos permanentemente e não faz nova tentativa após estado `UNCERTAIN`.
