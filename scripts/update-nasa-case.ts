import { readFile } from "node:fs/promises";
import { EditorialPillar, FunnelStage, FormatType, PostStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.ts";
import { scheduledDateForPillar } from "../src/lib/scheduling.ts";
import { sendPostForApproval } from "../src/lib/telegram.ts";

async function loadEnvFile(path: string): Promise<void> {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([^#=]+)=(.*)$/.exec(line);
      if (match && process.env[match[1].trim()] === undefined) {
        process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

await loadEnvFile(".env.local");
await loadEnvFile(".env");

const title = "De script Python a arquitetura de dados na AWS: escala com FinOps";
const textContent = `Escalabilidade não começa quando o volume explode. Começa quando a arquitetura deixa de depender de um script que ninguém consegue observar.

Em um case com dados da NASA, evoluí de um script Python agendado via systemd, gravando diretamente no PostgreSQL, para um pipeline end-to-end orquestrado pelo Apache Airflow em containers Docker na AWS EC2.

A arquitetura passou a seguir o modelo Medallion:

🟤 Bronze: JSON bruto da API da NASA armazenado no AWS S3.
⚙️ Airflow: task secundária consome o S3, aplica regras físicas e executa o processamento.
🟡 Gold: dados tratados carregados no PostgreSQL para consumo analítico.
🧠 ML: Isolation Forest para detecção de anomalias espaciais.
📊 Streamlit: Dashboard 3D para visualizar a energia destrutiva e os eventos relevantes.

Os maiores desafios não foram apenas de código:

🔐 Segurança/IAM: resolvi bloqueios de SCP usando usuários robôs e políticas IAM específicas para a integração Airflow-S3.
💰 FinOps: configurei o LocalExecutor para manter o Airflow dentro do limite de RAM de uma EC2 enxuta, reduzindo custo sem sacrificar a rastreabilidade.

O resultado foi a transformação de um script funcional em uma arquitetura observável, reprocessável e pronta para crescer. Esse é o ponto central da Engenharia de Dados: conectar confiabilidade técnica, governança e resultado de negócio.

Quer testar o Dashboard 3D ou analisar a implementação? Acesse o repositório no GitHub: https://github.com/Leoboas/linkedin-content-pipeline

#DataEngineering #ApacheAirflow #AWS #DataLake #FinOps #DataScience`;

if (textContent.length >= 2000) throw new Error(`Case NASA excede 2000 caracteres: ${textContent.length}.`);

const now = new Date();
let scheduled = scheduledDateForPillar(EditorialPillar.BOFU, now);
while (scheduled <= now) {
  scheduled = scheduledDateForPillar(EditorialPillar.BOFU, new Date(scheduled.getTime() + 7 * 24 * 60 * 60 * 1000));
}
try {
  const post = await prisma.post.findFirst({
    where: { editorialPillar: EditorialPillar.BOFU },
    orderBy: { createdAt: "desc" },
  });
  if (!post) throw new Error("Nenhum post BOFU encontrado para atualizar.");
  const alreadyPresented = post.title === title && post.status === PostStatus.AWAITING_APPROVAL;

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      title,
      textContent,
      editorialPillar: EditorialPillar.BOFU,
      funnelStage: FunnelStage.ACTION,
      formatType: FormatType.SINGLE_IMAGE,
      status: PostStatus.AWAITING_APPROVAL,
      scheduledFor: scheduled,
      scheduledDate: scheduled,
      feedbackText: null,
    },
  });
  if (!alreadyPresented) await sendPostForApproval(updated);
  console.log(JSON.stringify({ id: updated.id, status: updated.status, scheduledDate: updated.scheduledDate, characters: textContent.length }));
} finally {
  await prisma.$disconnect();
}
