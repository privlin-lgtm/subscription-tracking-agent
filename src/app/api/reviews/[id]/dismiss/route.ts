import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

const schema = z.object({
  notes: z.string().max(500).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const { id } = await context.params;
    const body = schema.parse(await request.json().catch(() => ({})));
    const item = await app.reviewService.dismiss(userId, id, body.notes);
    return NextResponse.json({ item });
  } catch (error) {
    return jsonError(error);
  }
}
