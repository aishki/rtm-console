import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LockScreen } from "@/components/chrome/LockScreen";
import { GATE_COOKIE, isUnlocked, safeNext } from "@/lib/server/gate";

// The password wall. Unlocked browsers go on to the page they asked for (the console by
// default; the console shell sends roles that cannot open it on to their first allowed tab).
export default async function Home({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = safeNext(Array.isArray(next) ? next[0] : next);
  if (isUnlocked((await cookies()).get(GATE_COOKIE)?.value)) redirect(target);
  return <LockScreen next={target} />;
}
