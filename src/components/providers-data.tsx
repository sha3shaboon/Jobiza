import { connection } from "next/server";
import { enabledProviders } from "@/lib/env";

/** Reads OAuth provider config at request time (not baked in at build). */
export async function withProviders<T>(render: (p: { google: boolean; orcid: boolean }) => T) {
  await connection();
  return render(enabledProviders());
}
