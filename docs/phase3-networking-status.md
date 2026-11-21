# Fase 3 — Networking Intelligence

## Estado

- `IMPLEMENTED_LOCALLY`: página privada `/admin/networking`, endpoints autenticados, modelos Prisma, migration aditiva e testes locais.
- `VALIDATED_IN_DEVELOPMENT`: pendente. O banco Development não foi conectado nem validado nesta etapa.
- `DEPLOYED_TO_PRODUCTION`: não. Nenhum deploy foi feito.

## Escopo implementado

- Busca manual de conteúdo e profissionais no LinkedIn por tecnologia, cargo, idioma e mercado. Os links abrem a pesquisa; o sistema não lê resultados, não faz scraping e não navega autenticado.
- Cadastro de referência com URL HTTPS canônica de `linkedin.com`, texto colado, autor/empresa opcionais, idioma, tema e score heurístico explicável de 0–5.
- Deduplicação de URL canônica por índice único; alvos com perfil repetido também são protegidos por URL/key únicas.
- Classificação lexical de tema, filtros por tema/idioma/empresa/status, edição e arquivamento.
- Assistente de comentário com cinco abordagens, uso do provider atual, contexto limitado, tentativa máxima diária configurável e máximo de três tentativas por referência/dia. Tentativas com falha também consomem orçamento; a reserva usa lock transacional do Postgres para evitar exceder o limite entre requisições concorrentes.
- O prompt trata texto importado como dado não confiável. Evidências privadas não são enviadas: somente fatos, experiências e projetos com visibilidade pública, autorização e status aceito. Gate local bloqueia claims pessoais de implementação e números sem suporte no texto-fonte/evidências selecionadas.
- Cópia não registra publicação. Um registro como publicado requer confirmação explícita e guarda o texto realmente publicado. Não existe integração de escrita para comentários, curtidas, convites ou mensagens.
- Routine manual diária 7+7+3+3 minutos em data local BRT; histórico de atividades idempotente, empresas reutilizam `MonitoredCompany` quando encontradas; tendências descritivas 7/30 dias sem inferência causal.
- O painel oferece link contextual à área Analytics da Fase 2.

## Persistência proposta nesta Fase

Nova migration `20261122150000_networking_intelligence` cria `NetworkingTopic`, `NetworkingReference`, `NetworkingCommentDraft`, `NetworkingAiAttempt`, `NetworkingActivity`, `NetworkingRoutine` e `NetworkingTarget`, além dos enums, índices e FK opcional a `MonitoredCompany`. A migration insere apenas temas técnicos padrão. Nenhuma migration foi aplicada a qualquer banco.

## Validação

- `prisma validate` e `prisma generate` locais.
- `typecheck`, `networking:test`, Analytics import/provider/insights e regressão de publicação.
- Build local do Next.js ainda precisa ser concluído na validação final da Fase 3.
- Persistência CRUD, FK, constraints e migração em banco vazio aguardam `.env.development.local` validado. Não usar Production para teste.

## Bloqueios e limites

- As pesquisas do LinkedIn são links manuais; a leitura exige texto fornecido pela pessoa. Não há validação de conteúdo remoto nem garantia de qualidade do texto copiado.
- Score 0–5 é heurístico e serve somente para priorização; não estima alcance ou conversão.
- OAuth/analytics não são necessários para este fluxo; integração existente não foi alterada.
- Antes de produção: configurar banco Development isolado, executar verificação do destino, replay da cadeia completa de migrations em banco vazio, testes de persistência, revisar migration, então aprovar a aplicação e deploy separadamente.
