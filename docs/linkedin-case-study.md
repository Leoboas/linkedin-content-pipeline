# Case técnico — Autonomous LinkedIn Content Engine

## Rascunho BOFU para publicação

Este projeto implementa um motor autônomo para transformar uma linha editorial em posts prontos para aprovação e publicação no LinkedIn.

O desafio não era apenas gerar texto com IA. Era coordenar um fluxo confiável:

- buscar contexto no `brand-dossier.md` e nos posts publicados de maior desempenho;
- gerar conteúdo com Hugging Face Serverless Inference;
- estimar o potencial de engajamento com uma heurística explicável;
- renderizar imagens e PDFs quando necessário;
- enviar o card para o Telegram com aprovação por botão;
- persistir a decisão no Postgres;
- publicar no LinkedIn respeitando o agendamento;
- repor automaticamente o estoque quando restar apenas um post aprovado.

Arquiteturalmente, o sistema usa Next.js App Router, Prisma, Inngest, Vercel Blob e APIs REST. Cada etapa é isolada em steps duráveis, com retries e validações de estado para evitar duplicidade.

O resultado é um pipeline serverless, auditável e orientado a dados. A IA produz o rascunho; o RAG preserva a consistência de marca; o score mostra por que aquele conteúdo merece revisão; e a aprovação humana continua sendo o controle final antes da publicação.

Esse projeto demonstra uma competência que considero essencial em Engenharia de Software: transformar uma chamada de modelo em um produto operacional, observável e seguro.

Repositório: [adicione aqui o link público do GitHub]

#TypeScript #Nextjs #Serverless #DataEngineering #AIEngineering #Automation #TechLeadership
