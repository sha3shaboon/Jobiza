import type { Metadata } from "next";
import { SettingsPanel } from "@/components/settings-panel";
import { CITATION_STYLES } from "@/lib/citation-styles";
import { requireSession } from "@/server/session";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user } = await requireSession();
  const settings = await getSettings(user.id);
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-[-0.02em]">Settings</h1>
      <p className="mt-2 text-lg text-muted">Your Anthropic key pays for the AI features. Jobiza never shares it.</p>
      <SettingsPanel initial={settings} citationStyles={[...CITATION_STYLES]} />
    </div>
  );
}
