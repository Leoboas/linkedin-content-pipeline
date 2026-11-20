console.error("prisma db push foi desabilitado: use migrations versionadas via npm run db:migrate:deploy após confirmar um banco isolado em .env.development.local.");
process.exitCode = 1;
