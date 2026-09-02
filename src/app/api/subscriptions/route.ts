import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUserId } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

const createSchema = z.object({
  vendor: z.string().min(1),
  priceAmount: z.number().positive(),
  currency: z.string().length(3),
  billingCycle: z.enum(["weekly", "monthly", "annual", "custom", "unknown"]),
  nextRenewalDate: z.string().nullable().optional(),
});

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const items = await app.subscriptionService.list(userId);
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) {
    return userId;
  }
  try {
    const input = createSchema.parse(await request.json());
    const item = await app.subscriptionService.create(userId, input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
