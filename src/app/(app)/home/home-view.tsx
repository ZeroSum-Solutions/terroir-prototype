import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  ListOrdered,
  MapPin,
  ScanLine,
  Users,
  Wine,
} from "lucide-react";

export type HomeRole = "owner" | "manager" | "staff";

export type HomeSnapshot = {
  bottleCount: number;
  openBottleCount: number;
  reviewCount: number;
  unbinnedBottleCount: number;
  eightysixedCount: number;
};

type Action = {
  href: string;
  label: string;
  detail: string;
  Icon: typeof Wine;
};

const ACTIONS: Record<HomeRole, Action[]> = {
  owner: [
    { href: "/insights", label: "Read insights", detail: "Health, value, and service signals", Icon: BarChart3 },
    { href: "/lists", label: "Manage wine lists", detail: "Edit and publish guest-facing lists", Icon: ListOrdered },
    { href: "/team", label: "Manage the team", detail: "Roles, invitations, and activity", Icon: Users },
  ],
  manager: [
    { href: "/scan", label: "Receive an invoice", detail: "Capture, review, and add stock", Icon: ScanLine },
    { href: "/reconcile-queue", label: "Resolve review queue", detail: "Check ambiguous inventory records", Icon: ClipboardCheck },
    { href: "/bins", label: "Place cellar stock", detail: "Review bins and unplaced bottles", Icon: Boxes },
  ],
  staff: [
    { href: "/cellar/open", label: "Open bottles", detail: "Track pours and remaining volume", Icon: Wine },
    { href: "/scan-bottle", label: "Scan a label", detail: "Find a wine in the cellar", Icon: ScanLine },
    { href: "/cellar", label: "Check availability", detail: "Search bottles and locations", Icon: MapPin },
  ],
};

const ROLE_COPY: Record<HomeRole, { eyebrow: string; title: string; intro: string }> = {
  owner: {
    eyebrow: "Director view",
    title: "Your cellar, at a glance",
    intro: "Collection health and the decisions that keep service moving.",
  },
  manager: {
    eyebrow: "Cellar view",
    title: "Tonight’s cellar",
    intro: "Receiving, placement, and review work drawn from the live inventory.",
  },
  staff: {
    eyebrow: "Service view",
    title: "Service workspace",
    intro: "The bottle and service tools you need, without changing your access.",
  },
};

export function HomeView({
  restaurantName,
  role,
  snapshot,
}: {
  restaurantName: string | null;
  role: HomeRole;
  snapshot: HomeSnapshot;
}) {
  const copy = ROLE_COPY[role];
  const metrics = [
    { label: "Bottles on hand", value: snapshot.bottleCount },
    { label: "Open tonight", value: snapshot.openBottleCount },
    { label: "Needs review", value: snapshot.reviewCount },
    { label: "Awaiting a bin", value: snapshot.unbinnedBottleCount },
  ];

  return (
    <section>
      <header className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-xl pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-2xl md:pt-2xl">
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
          {[restaurantName?.trim(), copy.eyebrow].filter(Boolean).join(" · ")}
        </p>
        <h1 className="mt-xs max-w-[720px] text-balance font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
          {copy.title}
        </h1>
        <p className="mt-sm max-w-[560px] text-pretty text-body text-ink-soft">
          {copy.intro}
        </p>
      </header>

      <div className="glass grid grid-cols-2 overflow-hidden rounded-card md:grid-cols-4" aria-label="Current cellar summary">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={`min-w-0 p-md ${index % 2 ? "border-l border-rule" : ""} ${index >= 2 ? "border-t border-rule md:border-t-0" : ""} ${index === 2 ? "md:border-l" : ""}`}
          >
            <p className="text-caption font-medium uppercase tracking-[0.18em] text-grey">{metric.label}</p>
            <p className="mt-xs font-serif text-heading-sm font-normal leading-none tabular text-ink">
              {metric.value.toLocaleString("en-US")}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-xl grid gap-lg lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
        <section aria-labelledby="home-priorities" className="card-surface overflow-hidden rounded-card">
          <div className="flex items-end justify-between gap-md border-b border-rule px-md py-md">
            <div>
              <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">Your workspace</p>
              <h2 id="home-priorities" className="mt-2xs font-serif text-subheading font-normal text-ink">Priorities</h2>
            </div>
            <span className="text-ledger capitalize text-grey">{role}</span>
          </div>
          <ul className="divide-y divide-rule">
            {ACTIONS[role].map(({ href, label, detail, Icon }) => (
              <li key={href}>
                <Link href={href} className="group flex min-h-[76px] items-center gap-md px-md py-sm transition-colors hover:bg-surface-raised focus-ring">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-pill border border-rule-strong text-accent">
                    <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-serif text-body-lg font-normal text-ink">{label}</span>
                    <span className="mt-2xs block text-body-sm text-grey">{detail}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-grey transition-colors group-hover:text-ink" strokeWidth={1.75} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <aside className="glass rounded-card p-md" aria-labelledby="service-status">
          <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">Live cellar</p>
          <h2 id="service-status" className="mt-2xs font-serif text-subheading font-normal text-ink">Service status</h2>
          <dl className="mt-md divide-y divide-rule border-y border-rule">
            <StatusRow label="Open bottles" value={snapshot.openBottleCount} />
            <StatusRow label="86’d wines" value={snapshot.eightysixedCount} />
            <StatusRow label="Review scans" value={snapshot.reviewCount} />
          </dl>
          <Link href="/cellar" className="mt-md inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring">
            Open cellar
          </Link>
        </aside>
      </div>
    </section>
  );
}

function StatusRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-md py-sm">
      <dt className="text-body-sm text-ink-soft">{label}</dt>
      <dd className="font-serif text-subheading font-normal tabular text-ink">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
