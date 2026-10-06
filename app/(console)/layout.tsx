import { ConsoleShell } from "@/components/chrome/ConsoleShell";

// Navbar + context bar + footer + toast stack + nudge host around every console screen.
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
