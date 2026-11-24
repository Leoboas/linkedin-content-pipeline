# Banco isolado para desenvolvimento

## Supabase Free (recomendado para testes sem projeto Neon adicional)

Use um projeto Supabase novo e vazio, criado no plano Free, sem importar ou clonar dados de Production. Não use `pipeline-db/main`, o branch `Development` derivado de Production, nem outro banco com dados desconhecidos. A conta Free pode pausar projetos com pouca atividade; isso não deve gerar cobrança, mas será necessário reativar o projeto no painel quando quiser usá-lo.

1. No Supabase, crie um projeto PostgreSQL independente e anote o project ref exibido no painel.
2. Em **Connect**, copie a conexão direta ou o **Session Pooler na porta 5432**. Em redes IPv4, o Session Pooler costuma ser necessário. Não use Transaction Pooler/porta 6543 para migrations.
3. Crie `.env.development.local` (arquivo ignorado pelo Git) com os campos abaixo. Guarde a URL e senha apenas localmente; não as envie no chat nem as configure na Vercel.

```dotenv
DB_PROVIDER=supabase
DB_ENVIRONMENT=development
DB_TARGET_CONFIRMED=true
SUPABASE_PROJECT_REF=project-ref-do-painel
DB_EXPECTED_SUPABASE_PROJECT_REF=project-ref-do-painel
DB_EXPECTED_FINGERPRINT=SUBSTITUIR_PELO_FINGERPRINT_VALIDADO
POSTGRES_PRISMA_URL=postgresql://usuario:senha@host-session-pooler.supabase.com:5432/postgres?sslmode=require
```

`npm run db:target:check` não abre conexão nem altera o banco. Compare project ref, host e database da URL com o painel Supabase. Para descobrir o fingerprint, deixe temporariamente o campo esperado diferente do observado; o erro mostrará o fingerprint calculado, que não contém senha nem query string. Preencha-o e rode a checagem novamente. A checagem também bloqueia URLs que coincidam com `POSTGRES_PRISMA_URL` em `.env` ou `.env.local`.

O guard valida host/ref Supabase, fingerprint, ambiente e conexão, e rejeita o Transaction Pooler. Os scripts de escrita carregam somente `.env.development.local`; não usam `.env` ou `.env.local` como destino. O Prisma recebe exclusivamente a URL validada.

Antes do replay, o banco deve estar vazio. `npm run db:migrate:deploy` verifica que não há dados nas tabelas de aplicação; `npm run persistence:integration` também se recusa a iniciar se encontrar dados. Use somente dados sintéticos. Não rode `npx vercel env pull`, `prisma db push` ou comandos Prisma de escrita diretamente.

## Neon (compatibilidade com configurações existentes)

O guard ainda suporta Neon com `DB_PROVIDER=neon` (ou sem `DB_PROVIDER`, por compatibilidade). Para este release, não use `pipeline-db/main` nem o branch Development que deriva de Production. Se usar outro Neon, ele precisa ser um destino independente e vazio, confirmado pelo projeto, branch e fingerprint antes de qualquer escrita.

## Banco vazio e migrations

Com o destino confirmado, execute o replay versionado e os testes de persistência em sequência. Se uma migration falhar por divergência, interrompa e investigue; não reescreva migrations aplicadas e não use `db push` para esconder drift.
