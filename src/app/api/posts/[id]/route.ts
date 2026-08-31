import { NextResponse } from "next/server";
import { PostStatus } from "@prisma/client";
import { isDashboardAuthorized } from "@/lib/dashboard-auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonResponse<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function postIdFrom(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return isUuid(id) ? id : null;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return errorResponse("Não autorizado.", 401);
  const id = await postIdFrom(context);
  if (!id) return errorResponse("ID de post inválido.", 400);
  try {
    const post = await prisma.post.findUnique({ where: { id } });
    return post ? jsonResponse(post) : errorResponse("Post não encontrado.", 404);
  } catch (error) {
    console.error("Falha ao consultar post do dashboard:", error);
    return errorResponse("Falha interna ao consultar o post.", 500);
  }
}

async function updatePost(request: Request, context: RouteContext): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return errorResponse("Configure o DASHBOARD_ADMIN_TOKEN para editar a agenda.", 401);
  const id = await postIdFrom(context);
  if (!id) return errorResponse("ID de post inválido.", 400);

  let body: { title?: unknown; textContent?: unknown; imagePrompt?: unknown; scheduledDate?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return errorResponse("Corpo JSON inválido.", 400);
  }

  const data: {
    title?: string;
    textContent?: string;
    imagePrompt?: string | null;
    scheduledDate?: Date;
    scheduledFor?: Date;
  } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return errorResponse("title inválido.", 400);
    data.title = body.title.trim().slice(0, 300);
  }
  if (body.textContent !== undefined) {
    if (typeof body.textContent !== "string" || !body.textContent.trim()) return errorResponse("textContent inválido.", 400);
    data.textContent = body.textContent.trim().slice(0, 12000);
  }
  if (body.imagePrompt !== undefined) {
    if (body.imagePrompt !== null && typeof body.imagePrompt !== "string") return errorResponse("imagePrompt inválido.", 400);
    data.imagePrompt = typeof body.imagePrompt === "string" ? body.imagePrompt.trim().slice(0, 12000) : null;
  }
  if (body.scheduledDate !== undefined) {
    if (typeof body.scheduledDate !== "string") return errorResponse("scheduledDate inválido.", 400);
    const scheduledDate = new Date(body.scheduledDate);
    if (Number.isNaN(scheduledDate.getTime())) return errorResponse("scheduledDate inválido.", 400);
    data.scheduledDate = scheduledDate;
    data.scheduledFor = scheduledDate;
  }
  if (Object.keys(data).length === 0) return errorResponse("Nenhuma alteração enviada.", 400);

  try {
    const current = await prisma.post.findUnique({ where: { id }, select: { status: true } });
    if (!current) return errorResponse("Post não encontrado.", 404);
    if (current.status === PostStatus.PUBLISHED || current.status === PostStatus.PUBLISHING) {
      return errorResponse("Posts publicados ou em publicação são somente leitura.", 409);
    }
    const updated = await prisma.post.update({ where: { id }, data });
    return jsonResponse(updated);
  } catch (error) {
    console.error("Falha ao atualizar post do dashboard:", error);
    return errorResponse("Falha interna ao salvar o post.", 500);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  return updatePost(request, context);
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  return updatePost(request, context);
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  if (!isDashboardAuthorized(request)) return errorResponse("Configure o DASHBOARD_ADMIN_TOKEN para cancelar o post.", 401);
  const id = await postIdFrom(context);
  if (!id) return errorResponse("ID de post inválido.", 400);
  try {
    const current = await prisma.post.findUnique({ where: { id }, select: { status: true } });
    if (!current) return errorResponse("Post não encontrado.", 404);
    if (current.status === PostStatus.PUBLISHED || current.status === PostStatus.PUBLISHING) {
      return errorResponse("Posts publicados ou em publicação não podem ser cancelados.", 409);
    }
    if (current.status === PostStatus.CANCELLED) return jsonResponse({ id, status: PostStatus.CANCELLED });
    const result = await prisma.post.updateMany({
      where: { id, status: current.status },
      data: { status: PostStatus.CANCELLED },
    });
    if (result.count === 0) return jsonResponse({ id, status: PostStatus.CANCELLED });
    return jsonResponse({ id, status: PostStatus.CANCELLED });
  } catch (error) {
    console.error("Falha ao cancelar post do dashboard:", error);
    return errorResponse("Falha interna ao cancelar o post.", 500);
  }
}
