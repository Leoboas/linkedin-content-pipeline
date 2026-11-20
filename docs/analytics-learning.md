# Ciclo de aprendizado editorial por analytics

## Auditoria do código antes da correção

- A coleta automática já existia em `src/lib/linkedin-analytics.ts` e era chamada pelo cron diário `/api/cron/maintenance`.
- A coleta parava imediatamente se `LINKEDIN_POST_ANALYTICS_ENABLED !== "true"`. Esse seletor não está definido em `.env` nem `.env.local` neste workspace; o exemplo documenta `false`. Portanto, no ambiente local, a coleta automática estava desligada. O valor de Production não foi consultado.
- O cliente chamava `GET /rest/memberCreatorPostAnalytics`, mas convertia uma resposta sem `elements` em contagem `0`. Em seguida, persistia um `PostMetric` com todos os contadores obrigatórios e padrão zero. Isso confundia dado ausente com zero real.
- O endpoint manual também convertia campo vazio ou inválido em zero, não guardava fonte nem janela de observação e atualizava `Post.engagementScore`, que é a projeção editorial, misturando previsão e desempenho observado.
- `PostMetric` não tinha origem, versão da API, identificador LinkedIn copiado no snapshot, janela 24h/72h/7d, estado de disponibilidade ou chave de idempotência.
- O RAG recuperava posts por `Post.engagementScore`, score projetado, e usava zero como fallback quando não existia snapshot. Logo, um score preditivo podia ser apresentado como desempenho.
- A rotina de manutenção já era diária, mas não existia relatório semanal reproduzível nem comparação por janela de exposição.

## Permissões e limites oficiais

O código não contém metadados do consentimento OAuth e não é possível confirmar o escopo de um token sem consultar a autorização efetiva. Não foi feita chamada autenticada nesta auditoria. A flag de analytics, sozinha, não concede permissão.

O endpoint de métricas de publicações `memberCreatorPostAnalytics` exige `r_member_postAnalytics` com consentimento do membro. A documentação oficial lista impressões, alcance de membros, reações, comentários e compartilhamentos e, em versões compatíveis, saves, sends, cliques, seguidores e visitas ao perfil atribuídas ao conteúdo. O endpoint atual do projeto usa API versionada `202606` por padrão. Visitas atribuídas ao post são diferentes de visitas totais ao perfil.

O acesso a métricas de perfil exige `r_member_profileAnalytics`. A rota oficialmente documentada `memberFollowersCount?q=me` mede contagem vitalícia de seguidores. Visualizações de perfil e aparições em busca não foram tratadas como disponíveis pela API neste código; podem ser importadas manualmente com fonte e período. A permissão listada não prova que o token atual recebeu consentimento.

Fontes: [Member Post Statistics — LinkedIn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-09), [Increasing Access — LinkedIn](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09), [Member Follower Statistics — LinkedIn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/follower-statistics?view=li-lms-2026-09).

## Semântica dos dados

- `NULL` significa que o valor não foi fornecido pela fonte; `0` só é persistido quando a fonte ou a importação explícita informou zero.
- `source` distingue `LINKEDIN_API`, `MANUAL` e `LEGACY`.
- `availability` diferencia snapshot completo, parcial, indisponível e legado desconhecido.
- `measurementWindow` separa marcos de idade (`24H`, `72H`, `7D`) e `LIFETIME`; `exposureHours` e `capturedAt` registram a idade real do post no instante de coleta.
- A API retorna contagens cumulativas de vida quando `dateRange` não é informado. Os marcos 24h/72h/7d são, portanto, snapshots cumulativos coletados no primeiro cron após aquela idade, não métricas isoladas do intervalo; comparação exata exige consultar `exposureHours` e evitar misturar idades muito diferentes.
- A chave estável de idempotência evita snapshots duplicados da mesma publicação, fonte, janela e dia de coleta.
- A projeção `Post.engagementScore` permanece separada da `PostMetric.interactionRate` observada.
- A coleta automática considera até cinco publicações por execução diária para respeitar limites conservadores; falhas não viram zero nem são convertidas em sucesso.
- A coleta manual de métricas de post aceita apenas posts publicados. `POST /api/admin/profile-metrics` aceita observações estruturadas de visitas ao perfil, seguidores e aparições em busca, com origem manual e intervalo opcional.

## Aprendizado editorial

O ranking RAG usa taxas observadas em snapshots API/manual com impressão positiva e reações, comentários e compartilhamentos todos disponíveis. Referências externas e projeções não são promovidas a desempenho real. O planejador recebe agrupamentos descritivos por janela, pilar, formato, idioma e tema. Hipóteses só são emitidas com pelo menos três posts por grupo, são rotuladas como exploratórias e sugerem testes, não conclusões causais.

O relatório semanal é protegido por `CRON_SECRET` e enviado ao Telegram pelo cron `/api/cron/analytics-report`. Impressões e demais métricas ausentes são exibidas como indisponíveis, com cobertura da amostra.

## Pendências operacionais

1. Confirmar no Developer Portal e no consentimento OAuth do membro que o app tem Community Management access e `r_member_postAnalytics`; atualizar o token por fluxo oficial de autorização se necessário.
2. Ativar `LINKEDIN_POST_ANALYTICS_ENABLED=true` somente depois da confirmação de escopo e testar uma chamada autorizada.
3. Ativar `LINKEDIN_PROFILE_ANALYTICS_ENABLED=true` somente se `r_member_profileAnalytics` estiver consentido.
4. Aplicar a migration aditiva apenas após validar a cadeia de migrations e o banco de destino. Nenhum comando de banco ou deploy foi executado nesta tarefa.
5. Os primeiros dados automáticos medirão a janela de exposição no primeiro cron diário após 24h/72h/7d; a hora observada pode ultrapassar o marco nominal e fica rastreada por `capturedAt`.
6. Dados da UI precisam ser importados manualmente para preencher o histórico; não há backfill de analytics por scraping.
# Fase 2 — ativação segura de analytics

## Flags e orçamento

Analytics está opt-in. A sincronização executada pelo cron exige simultaneamente:

- `LINKEDIN_ANALYTICS_CRON_ENABLED=true`;
- `LINKEDIN_API_BUDGET_ENABLED=true` e a migration aditiva `20261121100000_linkedin_api_budget` aplicada;
- o flag específico `LINKEDIN_POST_ANALYTICS_ENABLED=true` ou `LINKEDIN_PROFILE_ANALYTICS_ENABLED=true`;
- token OAuth válido e scopes efetivamente concedidos.

Os valores de exemplo mantêm tudo desligado. O orçamento compartilhado conta chamadas REST/upload feitas pelo código em janela móvel de 24 horas, incluindo leitura de analytics e operações de publicação. O default conservador é 30 chamadas; configure `LINKEDIN_API_DAILY_BUDGET` após confirmar o limite da aplicação e reserve margem para operações manuais. Analytics estima 11 chamadas por post; `LINKEDIN_ANALYTICS_MAX_POSTS_PER_RUN` limita trabalho por execução, mas não substitui o orçamento. GET/HEAD/PUT têm até duas tentativas adicionais com `Retry-After`/backoff; operações POST não são repetidas automaticamente para não duplicar publicações.

O ledger guarda apenas endpoint, operação, status HTTP e horário. Não persiste token, corpo de requisição ou resposta. Se a migration não existir no destino, mantenha o orçamento desligado; habilitá-lo faz as chamadas falharem fechadas antes de acessar o LinkedIn.

## OAuth

`npm run linkedin:oauth:audit` valida `/v2/userinfo` e compara o `sub` com o ID no `LINKEDIN_PERSON_URN`, sem imprimir identificadores. Para inspecionar scopes concedidos, configure localmente `LINKEDIN_CLIENT_ID` e `LINKEDIN_CLIENT_SECRET`; o script usa o endpoint oficial de introspecção e imprime apenas o status e os dois scopes de analytics. Ausência desses campos não impede uma validação básica do UserInfo, mas deixa os scopes indeterminados. O Developer Portal continua sendo a fonte para verificar produtos habilitados na aplicação.

## Coleta

Cada consulta `memberCreatorPostAnalytics` é feita por métrica e versão. Para a lista atual são estimadas 11 chamadas por post; um post submetido à execução pode consumir menos quando houver bloqueio, 401/403/429 ou falha transitória. Métrica ausente é persistida como `NULL`, zeros medidos permanecem zero, e o parser aceita `metricType` como string (API 202605+) ou objeto. Snapshots incluem URN, versão, data de coleta, janela e idade da publicação.

O cron permanece desabilitado até validação real de OAuth, migration e uma coleta idempotente em Development. Não habilitar flags em Production antes dessa validação.
