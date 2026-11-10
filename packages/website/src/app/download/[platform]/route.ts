import { NextResponse } from "next/server";

import { RELEASE_ASSETS } from "@/lib/downloads";

const ASSETS: Record<string, string> = {
  ...RELEASE_ASSETS,
  // One universal launcher covers Apple silicon and Intel.
  mac: RELEASE_ASSETS["mac-arm64"],
  macos: RELEASE_ASSETS["mac-arm64"],
  win: RELEASE_ASSETS.windows,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await params;
  const target = ASSETS[platform.toLowerCase()];

  if (!target) {
    return NextResponse.redirect(new URL("/download", request.url), 302);
  }

  return NextResponse.redirect(target, 302);
}
