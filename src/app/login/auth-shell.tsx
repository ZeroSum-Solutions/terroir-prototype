import Image from "next/image";

/**
 * The shared frame for every unauthenticated screen — /login,
 * /auth/reset-password and /invite/[token].
 *
 * Obsidian Glass (DESIGN.md — Masthead, Surfaces, Imagery): a full-bleed
 * photograph scrimmed down into the canvas, the wordmark in the named face
 * top-left, and the form itself in a glass sheet that is anchored to the
 * bottom of a phone (thumb reach) and centred on a desktop. The photograph is
 * the owner's supplied reference crop (public/design-refs — not licensed for
 * production, see DESIGN.md § Imagery).
 *
 * The sheet's own contents stay in the page: the sign-in inputs need a 16px
 * size to stop iOS zooming on focus, which is a per-file exception the
 * typography ratchet already records for those pages.
 */
export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-canvas">
      <Image
        src="/design-refs/merlot-terroir.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: "50% 40%" }}
        aria-hidden
      />
      {/* Built from the canvas token so the band fades into whichever room is
          on — obsidian by default, bone in daylight. Text never sits on the
          photograph: the glass sheet composes over the scrimmed ground. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-canvas) 40%, transparent) 0%, color-mix(in srgb, var(--color-canvas) 25%, transparent) 28%, color-mix(in srgb, var(--color-canvas) 72%, transparent) 62%, var(--color-canvas) 88%)",
        }}
        aria-hidden
      />
      <div className="relative flex min-h-screen flex-col px-md pb-md pt-lg sm:px-lg sm:pb-lg sm:pt-xl">
        <p className="font-serif font-medium uppercase tracking-[0.28em] text-primary">
          <span className="text-body-lg">Terroir</span>
        </p>
        <div className="flex flex-1 items-end justify-center pt-3xl sm:items-center sm:pt-xl">
          <div className="glass w-full max-w-[420px] rounded-card p-lg sm:p-xl">
            <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
              {eyebrow}
            </p>
            <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">
              {title}
            </h1>
            {description ? (
              <p className="mt-sm text-body-sm text-ink-soft">{description}</p>
            ) : null}
            <div className="mt-lg">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
