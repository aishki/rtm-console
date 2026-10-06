import { redirect } from "next/navigation";

// The console shell sends roles that cannot open the Console on to their first allowed tab.
export default function Home() {
  redirect("/console");
}
