# Banco isolado para desenvolvimento

Os comandos `db:migrate:deploy`, `db:reconcile-projects` e `knowledge:import` não usam `.env` nem `.env.local` como alvo. Eles carregam exclusivamente `.env.development.local`, validam a confirmação explícita do Neon e comparam o fingerprint do destino com os alvos encontrados nos dois arquivos locais existentes.

Crie no Neon um branch novo de desenvolvimento, independente do branch Production. Confirme no Console da Neon o projeto, o branch, o endpoint/host, o database e o usuário. Não use branch com dados clonados de Production: os testes da Etapa C devem usar banco vazio e dados sintéticos.

Crie `.env.development.local` (ignorado pelo Git) com:

```dotenv
DB_ENVIRONMENT=development
DB_TARGET_CONFIRMED=true
NEON_PROJECT_ID=project-id-confirmado-no-console
NEON_BRANCH_ID=branch-id-confirmado-no-console
DB_PRODUCTION_BRANCH_ID=branch-id-do-ambiente-production
DB_EXPECTED_NEON_PROJECT_ID=project-id-confirmado-no-console
DB_EXPECTED_NEON_BRANCH_ID=branch-id-confirmado-no-console
DB_EXPECTED_FINGERPRINT=SUBSTITUIR_PELO_FINGERPRINT_VALIDADO
POSTGRES_PRISMA_URL=postgresql://usuario:senha@endpoint-do-branch.neon.tech/database?sslmode=require
```

O fingerprint é SHA-256 de protocol, hostname, porta, database e usuário; a senha e query string não entram. Primeiro execute `npm run db:target:check` com fingerprint temporário para obter o valor observado no erro, compare projeto/branch/host no Console Neon e só então preencha `DB_EXPECTED_FINGERPRINT`. O comando de checagem não abre conexão. Execute novamente: confirmação bem-sucedida também não abre conexão.

O guard bloqueia se os IDs do projeto/branch divergem, se o fingerprint diverge, se o host não for Neon ou se a conexão coincidir com `POSTGRES_PRISMA_URL` de `.env`/`.env.local`. A rotina de migration passa ao Prisma CLI exatamente a conexão confirmada. Não use `npx prisma migrate`, `prisma db push` ou outro comando de escrita direto; `prisma:push` foi intencionalmente desabilitado.

Com o alvo confirmado, a sequência planejada é `npm run db:migrate:deploy`, seguida pelas verificações de schema e testes sintéticos. O banco de desenvolvimento deve estar vazio para o replay integral. Se uma migration falhar por dados divergentes, não edite migrations já aplicadas nem use `db push`: investigue e crie uma correção versionada após revisar a causa.
