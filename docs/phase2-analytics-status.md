# Fase 2 — Analytics e Performance Intelligence

## Escopo implementado localmente

- Reutiliza `PostMetric` para snapshots por publicação e adiciona campos nullable para distribuição dentro/fora da rede, audiência, origem detalhada e atraso da coleta.
- Adiciona `AnalyticsImportBatch` para hash do arquivo, mapeamento, reconciliações, erros e linhas não associadas; reimportar o mesmo arquivo reconcilia o mapeamento sem duplicar snapshots.
- Adiciona `AnalyticsCollectionAttempt` para registrar execuções automáticas como `RUNNING`, `SUCCEEDED`, `FAILED` ou `SKIPPED_BUDGET`, sem guardar tokens ou corpos HTTP.
- CSV e XLSX são lidos em Node.js com limite de upload/expansão, preview, detecção de colunas e escolha de associação por linha. Associação automática só ocorre por igualdade exata do LinkedIn post ID/URN. Títulos e nomes não são usados para adivinhar o post.
- Linhas não associadas ficam em `AnalyticsImportBatch.aggregateRows`, fora de rankings por publicação.
- A tela `/admin/analytics` passa a apresentar overview, filtros temporais, janelas D+1/D+3/D+7, gráficos simples, rankings, comparações com tamanho da amostra, posts individuais, importação e entrada manual por post. A entrada manual de métricas de perfil existente foi preservada.
- A camada oficial LinkedIn exige flags de recurso, token presente e confirmação explícita separada de permissão de post/perfil. Os exemplos mantêm todos esses flags desabilitados.

## Permissões e fonte oficial

`npm run linkedin:oauth:audit` foi executado com os arquivos locais sem imprimir credenciais. `/v2/userinfo` respondeu HTTP 401. A introspecção de scopes não pôde ser feita porque `LINKEDIN_CLIENT_ID` e `LINKEDIN_CLIENT_SECRET` não estão configurados neste workspace. Portanto, token e scopes continuam **não validados** e nenhum endpoint de analytics foi chamado.

A documentação do LinkedIn indica que `memberCreatorPostAnalytics` requer `r_member_postAnalytics` e Community Management API. A API documenta impressões, membros alcançados, reações, comentários, reposts e, conforme versão, saves, sends, cliques, seguidores atribuídos e visualizações do perfil atribuídas ao post. O endpoint não fornece as dimensões demográficas/cargo/país mostradas pelo Dashboard; essas permanecem `INSUFFICIENT_DATA` até importação explícita.

## Migration e ambiente

Migration aditiva preparada: `20261121180000_analytics_import_batches`. Ela não foi aplicada. Não houve acesso de escrita a banco nem deploy.

`.env.development.local` não existe neste workspace. Testes de persistência real e replay da migration foram omitidos; `.env` e `.env.local` não foram usados como destino de teste por não haver confirmação de isolamento.

## Interpretação e limites

- `NULL` continua diferente de zero.
- Alcance entre publicações não é somado como pessoas únicas.
- O percentual fora da rede só é derivado quando numeradores absolutos dentro/fora estão medidos no mesmo conjunto; caso contrário, usa-se mediana de percentuais explicitamente informados, ou `INSUFFICIENT_DATA`.
- D+1/D+3/D+7 são marcos de idade; `capturedAt`, `exposureHours` e `latenessHours` registram o momento/atraso reais.
- Comparações são descritivas, exibem amostra e não alteram calendário, idioma ou conteúdo.
- O histórico de referência de 534 impressões/226 pessoas alcançadas não foi inserido automaticamente. A tela manual permite registrá-lo somente após selecionar o post correto e informar data/origem.

## Estado de entrega

- `IMPLEMENTED_LOCALLY`: migrations, camada provider, importadores, rotas e Dashboard.
- `VALIDATED_IN_DEVELOPMENT`: não validado; ambiente Development não configurado.
- `DEPLOYED_TO_PRODUCTION`: não implantado.
