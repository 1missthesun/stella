import { NextResponse } from "next/server";

import { RELEASE_ASSETS } from "@/lib/downloads";

const ASSETS: Record<string, string> = RELEASE_ASSETS;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await params;
  const target = ASSETS[platform];

  if (!target) {
    return NextResponse.redirect(new URL("/", request.url), 302);
  }

  return NextResponse.redirect(target, 302);
}
