import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { verifyEmailToken } from "@/lib/auth/auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const result = await withTransaction((db) => verifyEmailToken(db, token));

  const redirect = result.ok
    ? "/dashboard"
    : "/login?error=" + encodeURIComponent(result.ok ? "" : result.error);
  return NextResponse.redirect(new URL(redirect, request.url));
}