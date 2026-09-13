import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";

/** Public root: authenticated members now share the first-class Home. */
export default async function Home() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  redirect("/home");
}
