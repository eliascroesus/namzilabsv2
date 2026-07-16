import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ status: "ok", service: "namzilabs", time: new Date().toISOString() });
}
