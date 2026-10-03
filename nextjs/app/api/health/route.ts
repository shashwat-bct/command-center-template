import { NextResponse } from "next/server";

const BOOT_TS = new Date().toISOString();

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: process.env.APP_VERSION ?? "0.14.0",
    bootedAt: BOOT_TS,
    uptimeSec: Math.round((Date.now() - new Date(BOOT_TS).getTime()) / 1000),
  });
}
