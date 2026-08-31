import { NextResponse } from "next/server";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

function validReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const references = await prisma.contentReference.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, content: true, sourceUrl: true, createdAt: true },
  });
  return NextResponse.json(references);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json() as { sourceUrl?: unknown; notes?: unknown };
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!validReferenceUrl(sourceUrl)) {
    return NextResponse.json({ error: "Informe uma URL HTTPS válida." }, { status: 400 });
  }
  if (notes.length > 5000) return NextResponse.json({ error: "As notas devem ter no máximo 5.000 caracteres." }, { status: 400 });
  const existing = await prisma.contentReference.findFirst({ where: { sourceUrl } });
  if (existing) return NextResponse.json(existing);
  const reference = await prisma.contentReference.create({
    data: { sourceUrl, content: notes || `Referência do LinkedIn: ${sourceUrl}` },
  });
  return NextResponse.json(reference, { status: 201 });
}
