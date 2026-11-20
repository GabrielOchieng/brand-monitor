import { redirect } from "next/navigation";

// Team moved into Settings; old links and bookmarks land on its tab.
export default function TeamPage() {
  redirect("/settings?section=team");
}
