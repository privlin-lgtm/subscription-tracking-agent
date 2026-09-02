import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

const updateSchema = z.object({
  vendor: z.string().min(1).optional(),
  priceAmount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  billingCycle: z.enum(["weekly", "monthly", "annual", "custom", "unknown"]).optional(),
  nextRenewalDate: z.string().nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const { id } = await context.params;
    const detail = await app.subscriptionService.getDetail(userId, id);
    return NextResponse.json(detail);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    const item = await app.subscriptionService.update(userId, id, input);
    return NextResponse.json({ item });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const { id } = await context.params;
    const item = await app.subscriptionService.cancel(userId, id);
    return NextResponse.json({ item });
  } catch (error) {
    return jsonError(error);
  }
}
