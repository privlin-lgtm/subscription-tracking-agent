import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/infrastructure/http/api";
import { app } from "@/infrastructure/composition";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = await app.registerService.register(body.email, body.password);
    return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
