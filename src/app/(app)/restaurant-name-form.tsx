"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function RestaurantNameForm({ restaurantId, initialName = "", onboarding = false }: {
  restaurantId: string;
  initialName?: string;
  onboarding?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !name.trim()) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/restaurant/${restaurantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) throw new Error("Could not save your restaurant name. Your entry is still here; try again.");
      setSaved(true);
      if (onboarding) router.push("/get-started");
      router.refresh();
    } catch {
      setError("Could not save your restaurant name. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-md space-y-sm" aria-busy={saving}>
      <label className="block text-caption font-medium uppercase tracking-[0.18em] text-grey">
        Restaurant name
        <input
          autoFocus={onboarding}
          autoComplete="organization"
          maxLength={200}
          required
          value={name}
          disabled={saving}
          onChange={(event) => { setName(event.target.value); setSaved(false); }}
          placeholder="Your restaurant"
          className="mt-xs min-h-11 h-[52px] w-full rounded-pill border border-rule-strong bg-surface-sunken px-md text-body-lg text-ink placeholder:text-grey focus-visible:border-accent focus-ring md:text-control"
        />
      </label>
      {error && <p role="alert" className="text-body-sm text-risk-ink">{error}</p>}
      {saved && <p role="status" className="text-body-sm text-ready-ink">Restaurant name saved.</p>}
      <button disabled={saving || !name.trim()} className="min-h-11 h-[52px] w-full rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring disabled:opacity-60">
        {saving ? "Saving…" : onboarding ? "Continue to setup" : "Save restaurant name"}
      </button>
    </form>
  );
}
