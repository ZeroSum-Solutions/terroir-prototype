import Link from "next/link";

export function ImportHeader({ step }: { step: "upload" | "preview" | "batch" | "session" }) {
  const current = step === "upload" ? 0 : step === "preview" ? 1 : 2;
  return <header className="mb-lg">
    <Link href="/get-started" className="mb-sm inline-flex min-h-11 items-center text-control text-accent underline underline-offset-4 focus-ring">Restaurant setup guide</Link>
    <h1 className="font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">Import cellar</h1>
    <p className="mt-sm text-body text-ink-soft">Bring in your stock from CSV or Excel. Review the preview, confirm the import, then apply the rows to your cellar.</p>
    <ol aria-label="Import progress" className="glass mt-md grid grid-cols-3 gap-2xs rounded-pill p-3xs">
      {["Choose file", "Review rows", "Apply stock"].map((label, index) => <li key={label} aria-current={current === index ? "step" : undefined} className={`flex min-h-11 items-center justify-center rounded-pill px-2xs text-center text-ledger font-medium ${current === index ? "bg-primary text-seal-ink" : "text-grey"}`}>
        {index + 1}. {label}
      </li>)}
    </ol>
  </header>;
}
