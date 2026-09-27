import { admitPhysicalV2Target } from "./admission";

export default async function globalSetup(): Promise<void> {
  await admitPhysicalV2Target();
}
