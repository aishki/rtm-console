import { type NextRequest, NextResponse } from "next/server";
import { GATE_COOKIE, isUnlocked } from "@/lib/server/gate";

// The password wall: until a browser holds a valid unlock cookie, every page sends it to the
// lock screen at "/" and every API route answers 401. Only "/" and its unlock route get through.

export function proxy(request: NextRequest) {
  if (isUnlocked(request.cookies.get(GATE_COOKIE)?.value)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/" || pathname === "/api/unlock") return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Locked. Enter the console password first." }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Static files the lock screen itself needs stay reachable: Next's assets, the logos and the
  // service worker script.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|assets/).*)"],
};
