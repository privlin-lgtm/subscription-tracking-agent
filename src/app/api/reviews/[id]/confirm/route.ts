import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

const schema = z.object({
  vendorNormalized: z.string().min(1).optional(),
  priceAmount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  billingCycle: z.enum(["weekly", "monthly", "annual", "custom", "unknown"]).optional(),
  nextRenewalDate: z.string().nullable().optional(),
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
    const input = schema.parse(await request.json().catch(() => ({})));
    const item = await app.reviewService.confirm(userId, id, input);
    return NextResponse.json({ item });
  } catch (error) {
    return jsonError(error);
  }
}
