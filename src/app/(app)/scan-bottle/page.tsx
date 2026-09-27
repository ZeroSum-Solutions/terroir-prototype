import { getAuthContext } from "@/lib/auth-context";
import ScanBottleClient from "./scan-bottle-client";

export default async function ScanBottlePage() {
  const auth = await getAuthContext();
  return <ScanBottleClient userId={auth?.user.id ?? null} />;
}
