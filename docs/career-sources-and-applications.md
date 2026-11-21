# Career Intelligence: fontes e candidaturas

## Fontes internacionais e restrições

Estado atual no código:

| Fonte | Estado | Descoberta | Candidatura |
|---|---|---|---|
| Coderio / Lever | `ACTIVE_API` | Lever Postings API pública; vagas publicadas e `applyUrl` oficial | Assistida pelo formulário oficial; envio programático bloqueado porque a API de candidatura requer chave de empregador |
| Himalayas | `ACTIVE_API` | API pública | Link oficial |
| Remotive | `ACTIVE_API` | API pública | Link oficial |
| Remote OK | `ACTIVE_API` | API pública | Link oficial |
| We Work Remotely | `ACTIVE_RSS` | RSS público, com atribuição | Deve seguir para o site da fonte |
| Wellfound | `EMAIL_IMPORT` / `MANUAL_ONLY` | Importação de alerta com URL e corpo fornecidos pelo usuário; não há scraping/logon | Link oficial do Wellfound |
| Arc.dev, VanHack, Andela, Lemon.io, EU Remote Jobs, YC Jobs, Landing.Jobs e Relocate.me | `MANUAL_ONLY` | Sem conector automático anunciado nesta versão | Link oficial |
| Greenhouse, Ashby, Workable, SmartRecruiters e Lever de outras empresas | `MANUAL_ONLY` | Exigem board/empresa configurados e verificação da API de cada origem | Link oficial |

`MonitoredCompany` inclui Coderio como prioridade 1 e o board Lever `coderio`. Não foi inferido que toda oportunidade da empresa seja compatível com o Brasil; a elegibilidade é avaliada por anúncio.

O Dashboard permite selecionar apenas conectores ativos e mercados empresariais. Grande parte das APIs não expõe sede da empresa de modo confiável; nesses casos, o mercado fica `UNKNOWN`, e o anúncio continua visível para revisão em vez de ser classificado pelo local do emprego.

Elegibilidade de residência é armazenada separadamente da localização do trabalho e da sede empresarial: `BRAZIL_ELIGIBLE`, `LATAM_ELIGIBLE`, `WORLDWIDE_ELIGIBLE`, `RELOCATION_REQUIRED`, `REGION_RESTRICTED` e `UNKNOWN`. Menções ambíguas a remoto não são consideradas prova. Uma restrição explícita aos EUA ou uma lista explícita de países sem Brasil resulta em restrição; os casos desconhecidos permanecem revisáveis.

O campo `rawData.geography` mantém evidência textual observada sobre país, contratação contractor/PJ, EOR, visto e sobreposição de fuso. Menção de uma modalidade não significa elegibilidade comprovada.

Wellfound não é acessado com sessão autenticada: o formulário de validação manual aceita URL e descrição/alerta colados pelo usuário. A rota de inbound-email reconhece URLs Wellfound, mas só analisa o conteúdo recebido no e-mail; se faltar descrição, pede importação manual e não tenta ler a página. CAPTCHA, login, coleta automatizada e submissão automática não são implementados.

Nenhum conector atual possui autorização de candidatura programática. No caso de Lever, o endpoint de criação de candidatura requer chave API gerada por administrador da conta empregadora; uma conta comum de candidato não fornece essa credencial.

O teste de fontes verifica APIs e RSS ao vivo, parsers, atribuição, deduplicação e classificação geográfica; não realiza gravações. A persistência via Prisma usa upsert por origem e identificador e depende da migration aditiva `20261122120000_expand_international_career_sources`, ainda não aplicada a nenhum banco por esta execução.

## Descoberta ativa

O fluxo atual usa quatro APIs públicas (Coderio/Lever, Himalayas, Remotive e Remote OK) e o RSS público da We Work Remotely. Os conectores fazem descoberta e abrem o link oficial, mas não submetem candidatura. O serviço mantém `rawData.sourceRefs` para atribuição e deduplicação, e registra estado, quantidade encontrada e quantidade processada por conector no `CareerSearchRun`.

- Himalayas: API documentada, requer link visível e atribuição; para a ação de candidatura, usa o `applicationLink` retornado pela API. O conector descarta itens sem esse link.
- Coderio/Lever: `GET /v0/postings/coderio?mode=json`; usa `applyUrl` como destino da candidatura e conserva `hostedUrl` para referência.
- Remotive: API pública de vagas remotas; o dashboard mantém link e atribuição.
- Remote OK: API pública JSON; o dashboard mantém crédito e link ao anúncio original.
- We Work Remotely: RSS público com atribuição explícita; o fluxo abre a candidatura no próprio site da fonte.
- LinkedIn: não usamos o endpoint Guest HTML no fluxo ativo. A busca nativa do LinkedIn continua disponível como link manual; scraping em escala não é tratado como API autorizada.
- Wellfound: sem scraping ou login; aceita importação manual ou conteúdo de alertas autorizado.
- Outros boards/ATS sem board de empresa configurado: `MANUAL_ONLY` até que uma integração pública/autorizada seja verificada.

Uma resposta `202` da API de disparo significa apenas que o evento Inngest foi enfileirado. O Dashboard mantém o `runId`, consulta essa execução específica e exibe `QUEUED`, `RUNNING`, `COMPLETED`, `PARTIAL_SUCCESS` ou `FAILED`, incluindo os resultados por fonte.

## Localização e elegibilidade

A preferência aceita nomes localizados ou códigos conhecidos (`Brasil`/`Brazil` → `BR`, `Estados Unidos`/`United States` → `US`, `Remote` → `REMOTE`). A elegibilidade é distinta do score técnico e usa os estados específicos descritos acima. Um score alto não supera restrição de residência/autorização.

## Currículos

A biblioteca é fechada a quatro DOCX autorizados, com importação por nome exato, SHA-256, limite de tamanho e armazenamento em `bytea` no banco privado. Download exige sessão autenticada e usa `Cache-Control: private, no-store`. O sistema não gera nem reescreve novos currículos. Nenhum dos quatro arquivos estava presente no workspace nem na pasta Downloads verificada nesta implementação; até a importação, as recomendações de currículo ficam sem arquivo selecionado e candidatura preparada com CV fica bloqueada.

## Candidatura

Não há conector de submissão autorizado implementado. O fluxo atual é assistido: abre o formulário oficial em nova aba e mantém o registro no tracker. `APPLIED` só é aceito no tracker se o usuário informar um comprovante/identificador de confirmação do portal. Não há auto-apply habilitado nem candidaturas enviadas por testes.

## Banco

A migration de estados `20261121120000_extend_career_search_run_status` deve ser aplicada antes da migration aditiva `20261121130000_career_intelligence_sources_and_resume_library`. Ambas devem ser aplicadas apenas em Development isolado após confirmar o alvo através do procedimento em `docs/database-development.md`. Nesta entrega não houve conexão de escrita, migration aplicada, backfill ou deploy. Sem `.env.development.local`, persistência real e replay em banco isolado permanecem pendentes.
