import Link from "next/link";

export function ImportHeader({ step }: { step: "upload" | "preview" | "batch" | "session" }) {
  const current = step === "upload" ? 0 : step === "preview" ? 1 : 2;
  return <header className="mb-lg">
    <Link href="/get-started" className="mb-sm inline-flex min-h-11 items-center text-control text-grey underline underline-offset-4 focus-ring">Restaurant setup guide</Link>
    <h1 className="font-serif text-heading-sm font-normal leading-tight text-ink md:text-heading">Import cellar</h1>
    <p className="mt-sm text-control text-grey">Bring in your stock from CSV or Excel. Review the preview, confirm the import, then apply the rows to your cellar.</p>
    <ol aria-label="Import progress" className="mt-md grid grid-cols-3 gap-xs">
      {["Choose file", "Review rows", "Apply stock"].map((label, index) => <li key={label} aria-current={current === index ? "step" : undefined} className={`border-t-2 pt-xs text-control ${current === index ? "border-accent font-medium text-ink" : "border-rule text-grey"}`}>
        {index + 1}. {label}
      </li>)}
    </ol>
  </header>;
}
