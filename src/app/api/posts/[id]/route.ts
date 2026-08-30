import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function canEdit(request: Request): boolean {
  const token = process.env.DASHBOARD_ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!canEdit(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "ID de post inválido." }, { status: 400 });
  const post = await prisma.post.findUnique({ where: { id } });
  return post
    ? NextResponse.json(post)
    : NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!canEdit(request)) return NextResponse.json({ error: "Configure DASHBOARD_ADMIN_TOKEN para editar a agenda." }, { status: 401 });
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "ID de post inválido." }, { status: 400 });
  const body = await request.json() as {
    title?: unknown;
    textContent?: unknown;
    imagePrompt?: unknown;
    scheduledDate?: unknown;
  };

  const data: {
    title?: string;
    textContent?: string;
    imagePrompt?: string | null;
    scheduledDate?: Date;
    scheduledFor?: Date;
  } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "title inválido." }, { status: 400 });
    data.title = body.title.trim().slice(0, 300);
  }
  if (body.textContent !== undefined) {
    if (typeof body.textContent !== "string" || !body.textContent.trim()) return NextResponse.json({ error: "textContent inválido." }, { status: 400 });
    data.textContent = body.textContent.trim().slice(0, 12000);
  }
  if (body.imagePrompt !== undefined) {
    if (body.imagePrompt !== null && typeof body.imagePrompt !== "string") return NextResponse.json({ error: "imagePrompt inválido." }, { status: 400 });
    data.imagePrompt = typeof body.imagePrompt === "string" ? body.imagePrompt.trim().slice(0, 12000) : null;
  }
  if (body.scheduledDate !== undefined) {
    if (typeof body.scheduledDate !== "string") return NextResponse.json({ error: "scheduledDate inválido." }, { status: 400 });
    const scheduledDate = new Date(body.scheduledDate);
    if (Number.isNaN(scheduledDate.getTime())) return NextResponse.json({ error: "scheduledDate inválido." }, { status: 400 });
    data.scheduledDate = scheduledDate;
    data.scheduledFor = scheduledDate;
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nenhuma alteração enviada." }, { status: 400 });
  const current = await prisma.post.findUnique({ where: { id }, select: { status: true } });
  if (!current) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
  if (current.status === PostStatus.PUBLISHED) return NextResponse.json({ error: "Posts publicados são somente leitura." }, { status: 409 });

  const updated = await prisma.post.update({ where: { id }, data });
  return NextResponse.json(updated);
}
