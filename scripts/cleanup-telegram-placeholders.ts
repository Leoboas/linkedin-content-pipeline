import { prisma } from "../src/lib/prisma.ts";

const result = await prisma.jobListing.deleteMany({
  where: { title: "Vaga compartilhada pelo Telegram" },
});

console.log("Placeholders removidos:", result.count);
await prisma.$disconnect();
