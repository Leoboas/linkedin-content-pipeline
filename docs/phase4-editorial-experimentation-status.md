# LinkedIn Content Engine V3 — Fase 4 (implementação local)

Data da auditoria: 2026-11-21. Esta documentação descreve o worktree local; não comprova persistência em Development nem disponibilidade em Production.

## Auditoria de reutilização das Fases 1–3

| Estrutura existente | Responsabilidade observada | Reutilização nesta fase | Ajuste/estrutura nova |
| --- | --- | --- | --- |
| `Post`, `PostVersion`, `ContentBrief`, `CreativeBrief`, `PostApprovalEvent` | Conteúdo, versões, evidências/briefings e aprovação versionada | Posts publicados e metadados editoriais são participantes e dimensões de comparação; sem mudar aprovação/publicação | Relação `EditorialExperimentPost` associa post e braço do experimento |
| `PostMetric`, `ProfileMetric`, `AnalyticsImportBatch`, `AnalyticsCollectionAttempt` | Snapshots por publicação/janela, dados manuais/importados e proveniência | Fonte primária de medições; métricas ausentes permanecem `null`; usa uma observação por post e janela | `EditorialExperimentEvaluation` preserva snapshots de análises por fingerprint |
| `qualityReview.editorialIntelligence` e `CreativeBriefEvidence` | Career Relevance, Hook Quality e evidência usada no criativo | Dimensões determinísticas de hook/evidência nas recomendações quando os metadados existem | Sem duplicar pontuações nem reconstruir fatos históricos |
| `EditorialLine` | Frequência, distribuição de idiomas e agenda | Snapshot de configuração no início do ciclo; valida 4 posts, 2 EN + 2 PT-BR | `EditorialLearningCycle` guarda datas e snapshot sem modificar calendário |
| `NetworkingReference`, `NetworkingActivity`, `NetworkingTarget` | Referências e atividades de networking registradas manualmente | Contagens e tendências semanais; apenas publicação confirmada é tratada como tal | `CareerOutcome` pode apontar para uma atividade com associação confirmada/hipotética |
| `CandidateProfile`, `JobListing`, `JobMatch`, `JobApplication` | Vagas, match e candidaturas existentes | O resultado profissional pode referenciar uma candidatura já cadastrada | FK opcional de `CareerOutcome`; sem replicar currículo, descrição da vaga ou status da candidatura |
| `/admin/analytics`, insights e cron atual | Dashboard e ingestão/relatórios de analytics | Navegação integrada; cron de publicação permanece intocado | `/admin/experimentation`, recomendações auditáveis e exportação D+30/60/90 |

### Lacunas encontradas

- Não havia modelo de experimento com hipótese, variável, período, grupos e status próprios.
- Não havia resultado de carreira com origem explícita e ligação opcional comprovável a post, atividade de networking ou candidatura.
- Não havia ciclo configurável de 90 dias, recomendação editorial persistida com decisão humana ou avaliação versionada do experimento.
- Analytics já distingue snapshots/janelas e dados ausentes; foi reutilizado, não refeito.
- Dados demográficos são apenas rótulos agregados importados. A nova correspondência conta snapshots de posts, não visualizadores únicos nem indivíduos.

## Fase 4 implementada localmente

- Ciclo configurável com fases BASELINE (dias 1–30), EXPERIMENTATION (31–60) e CONSOLIDATION (61–90). A configuração só é criada se a estratégia vigente já for 4 publicações, 2 EN e 2 PT-BR; não altera o calendário.
- Experimentos com braço A/B ou mais grupos, posts publicados, métrica principal, janela fixa, amostra mínima, status, análise determinística e limitações explícitas.
- Avaliação de experimento usa o snapshot mais recente por post na janela selecionada, exige publicação dentro do período, preserva `NULL`, exclui comparações abaixo do mínimo e registra fontes. Um fingerprint torna o histórico idempotente.
- Nova métrica recebida por API manual, importação CSV/XLSX ou sincronização oficial tenta atualizar somente os experimentos vinculados ao post. Falha nesse recálculo não invalida a gravação de métricas; há botão autenticado de recálculo manual.
- Recomendações derivadas de dados observados em janela 7D, com mínimo n=4 em cada lado; dimensões disponíveis: idioma, formato visual, pilar, tema, objetivo, tipo de evidência e faixa de hook. Confiança é uma indicação operacional, não significância estatística. A recomendação nunca muda pauta, horário ou publicação.
- Resultados de carreira distinguem origem e associação. `POST_CONFIRMED` e `NETWORKING_CONFIRMED` exigem vínculo e evidência; associação hipotética é marcada como tal. Resultado `UNKNOWN` sem vínculo é válido. Contatos ficam apenas em APIs/telas autenticadas.
- Linha do tempo semanal em `America/Sao_Paulo` mostra posts, networking e resultados lado a lado, explicitamente observacionais.
- Relatórios protegidos por autenticação em Markdown e CSV; campos ausentes não viram zero, alcance não é somado entre posts como pessoas únicas.

## Arquivos novos/alterados nesta etapa

- `prisma/schema.prisma`
- `prisma/migrations/20261122160000_experimental_editorial_career_outcomes/migration.sql`
- `src/lib/editorial-experimentation.ts`
- `src/lib/experimentation-persistence.ts`
- `src/app/api/admin/experimentation/route.ts`
- `src/app/api/admin/experimentation/report/route.ts`
- `src/app/admin/experimentation/page.tsx`
- `src/app/admin/experimentation/EditorialExperimentationDashboard.tsx`
- `src/app/admin/AdminNav.tsx`
- `src/app/globals.css`
- `scripts/test-editorial-experimentation.ts`
- `package.json`

## Segurança, impacto e limites

- Migration aditiva; não executada em banco algum. Não contém remoção de tabelas/colunas/dados.
- Nenhuma publicação, candidatura, mensagem ou interação no LinkedIn é automatizada.
- Nenhum post histórico foi alterado; não foram criados dados históricos nem briefings retroativos.
- Nenhum job Inngest novo foi introduzido: resultados são atualizados somente para o experimento afetado quando chegam métricas, com atualização manual disponível. Evita recomputar o histórico inteiro em cron.
- `CareerOutcome` não prova causalidade. Um registro ligado a post exige evidência do usuário; temporalidade isolada não gera associação.
- A recomendação é determinística; não chama IA e não gera tendência quando não há amostra suficiente.
- A fase ainda não foi validada em banco Development real. Portanto, relações físicas, migration replay, idempotência transacional real e UI/API com persistência real continuam pendentes.

## Estado operacional

- `IMPLEMENTED_LOCALLY`: sim.
- `VALIDATED_IN_DEVELOPMENT`: não; falta configuração Development explicitamente identificada e autorizada.
- `DEPLOYED_TO_PRODUCTION`: não; nenhum deploy foi executado.
- Migration da Fase 4: criada localmente, pendente.
- Frequência e idioma: preservados no código e não aplicados a `EditorialLine`.
- Dados de produção: nenhum acesso de escrita nesta fase.

## Testes previstos no ambiente isolado

Após o destino Development ser confirmado: replay de migrations versionadas em banco vazio, `db:target:check`, status/deploy apenas nesse destino, `persistence:integration`, criação/edição de experimento, snapshots por janela, idempotência por fingerprint, associação confirmada/hipotética de resultados, proteção de dados privados e teste do ciclo/recomendações. Dados sintéticos apenas.
