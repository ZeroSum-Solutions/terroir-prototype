import Link from "next/link";
import {
  Archive,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  FileUp,
  ListOrdered,
  Map,
  ScanLine,
  SlidersHorizontal,
  Users,
  Wine,
} from "lucide-react";

type Role = "owner" | "manager" | "staff";
type Item = {
  href: string;
  label: string;
  description: string;
  Icon: typeof Wine;
  management?: boolean;
};

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: "Cellar",
    items: [
      { href: "/cellar", label: "Cellar index", description: "Find, pour and manage availability", Icon: Wine },
      { href: "/scan?mode=bottle", label: "Label scan", description: "Identify a bottle from its label", Icon: ScanLine },
      { href: "/atlas", label: "Atlas", description: "Browse the cellar by geography", Icon: Map },
      { href: "/cellar/open", label: "Open bottles", description: "Review active bottles and pours", Icon: Archive },
      { href: "/bins", label: "Bin map", description: "Storage zones and placement", Icon: Boxes, management: true },
      { href: "/cellar/config", label: "Cellar setup", description: "Sections, naming and display", Icon: SlidersHorizontal, management: true },
    ],
  },
  {
    title: "Receiving & data",
    items: [
      { href: "/scan", label: "Invoice receiving", description: "Photo or PDF to reviewed line items", Icon: ScanLine, management: true },
      { href: "/reconcile-queue", label: "Reconciliation queue", description: "Review uncertain matches and placement", Icon: ClipboardCheck, management: true },
      { href: "/import", label: "CSV inventory import", description: "Preview, review and apply a file", Icon: FileUp, management: true },
      { href: "/scans", label: "Scan history", description: "Return to prior invoice scans", Icon: BookOpen, management: true },
    ],
  },
  {
    title: "Program",
    items: [
      { href: "/lists", label: "Wine lists", description: "Build, preview and publish lists", Icon: ListOrdered },
      { href: "/price-comparison", label: "Pricing", description: "Review list and retail signals", Icon: CircleDollarSign },
      { href: "/insights", label: "Insights", description: "Cellar health and operating trends", Icon: BarChart3 },
      { href: "/team", label: "Team", description: "Roster, access and performance", Icon: Users },
      { href: "/get-started", label: "Setup guide", description: "A practical path through Terroir", Icon: BookOpen },
    ],
  },
];

export function OperationsLauncher({ userRole, compact = false, onNavigate }: {
  userRole: Role;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const canManage = userRole === "owner" || userRole === "manager";
  return <div className={compact ? "space-y-md" : "space-y-xl"}>
    {GROUPS.map((group) => {
      const items = group.items.filter((item) => canManage || !item.management);
      if (items.length === 0) return null;
      return <section key={group.title}>
        <h2 className="mb-sm text-caption font-medium uppercase tracking-[0.18em] text-grey">{group.title}</h2>
        <ul className={compact ? "overflow-hidden rounded-card border border-rule" : "grid gap-sm sm:grid-cols-2"}>
          {items.map(({ href, label, description, Icon }) => <li key={href}>
            <Link href={href} onClick={onNavigate} className={`group flex min-h-11 items-center gap-md text-left transition-colors hover:border-accent focus-ring ${compact ? "border-b border-rule px-md py-sm last:border-b-0" : "glass rounded-card p-md"}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-wash text-accent"><Icon className="h-5 w-5" strokeWidth={1.6} aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-body-lg text-ink group-hover:text-accent">{label}</span>
                <span className="mt-2xs block text-ledger text-grey">{description}</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-grey group-hover:text-accent" strokeWidth={1.6} aria-hidden />
            </Link>
          </li>)}
        </ul>
      </section>;
    })}
  </div>;
}
