# Candidatura autorizada por vaga

Em `/career/applications`, abra a revisão do kit mais recente. O formulário Lever é lido da conta autorizada da empresa. Revise cargo, destino, PDFs separados e cada resposta; a autorização cria um snapshot privado antes de enfileirar a execução. Aprovações antigas de documentos não autorizam envio.

O envio real requer `LEVER_API_KEY` com acesso concedido pelo administrador da conta Lever da empresa para leitura da vaga e do formulário, uploads e candidatura. Uma chave de outra empresa não serve: o endereço e o ID retornados pela API são comparados com a vaga. A chave não deve ser salva no repositório nem exposta no frontend. A integração suporta somente o formato de formulário analisado e exige campos separados para os dois PDFs; outros formulários ficam pendentes de ação.

Para uma conta sandbox autorizada, configure `LEVER_SANDBOX=true` e `CAREER_SUBMISSION_DRY_RUN=true`. O teste prepara e envia os arquivos ao endpoint de uploads sandbox, verifica novamente o formulário e para antes do POST de candidatura. Use somente vagas e dados sintéticos. O ambiente e a modalidade são registrados com a autorização. O sandbox real ainda precisa ser validado com a conta do provedor.

O registro de autorização é também a outbox. Um evento imediato acorda o worker e um cron Inngest busca itens pendentes a cada cinco minutos. O início do envio é persistido antes do POST; qualquer resposta ausente ou interrupção após esse ponto é incerta e não é reenviada automaticamente. Verifique o portal ou solicite confirmação ao empregador antes de qualquer nova tentativa. `CONFIRMED` exige o ID de candidatura retornado pelo Lever.

O banco armazena currículo, carta e respostas aprovados em campos privados; não inclua esses dados em logs ou eventos Inngest. A migration `20261124190000_application_submission_authorization` deve ser aplicada antes do deploy. Depois, sincronize as funções Inngest. A migration foi preparada para ser aditiva e deve passar pelas verificações e pelo procedimento de recuperação próprios do ambiente de produção.

Testes: `npm run career:lever:test` usa somente um destino simulado; `npm run career:submission:integration` exige o Supabase isolado configurado por `docs/database-development.md`, com tabelas de aplicação vazias, e remove apenas seus registros sintéticos identificados. `npm run career:submission:ui:test` verifica login, revisão, respostas, anexos e estado enfileirado em navegador com APIs sintéticas. Nenhum deles comprova permissão real ou candidatura em uma conta Lever.
