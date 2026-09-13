"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Search, ShieldCheck } from "lucide-react";
import type { AssistantResponse } from "@/lib/wine-intelligence/assistant-types";
import { CellarResult, CorpusResult } from "./assistant-results";

const EXAMPLES = [
  "a bold red that pairs with beef",
  "something under $40 for fish",
  "a blend from Argentina, $200-400, for meats",
  "a crisp white from Portugal",
];

export function chipsFor(query: AssistantResponse["query"]): string[] {
  const chips: string[] = [];
  if (query.vintages?.length) chips.push(query.vintages.join(" or "));
  if (query.type) chips.push(query.type);
  if (query.body) chips.push(query.body);
  if (query.blend === true) chips.push("Blend");
  if (query.blend === false) chips.push("Single varietal");
  if (query.grape) chips.push(query.grape);
  if (query.region) chips.push(query.region);
  if (query.country) chips.push(query.country);
  if (query.pairing?.length) chips.push(`Pairs with ${query.pairing.join(" or ")}`);
  if (query.priceMin != null && query.priceMax != null) chips.push(`$${query.priceMin}–$${query.priceMax}`);
  else if (query.priceMax != null) chips.push(`Under $${query.priceMax}`);
  else if (query.priceMin != null) chips.push(`Over $${query.priceMin}`);
  return chips;
}

export function AssistantExperience({ seedQuestion = null, onNavigate, compact = false }: {
  seedQuestion?: string | null;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const latest = useRef(0);
  const [question, setQuestion] = useState(seedQuestion ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResponse | null>(null);

  const ask = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const ticket = ++latest.current;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/assistant?q=${encodeURIComponent(trimmed)}`);
      if (ticket !== latest.current) return;
      if (!response.ok) throw new Error("assistant request failed");
      setResult((await response.json()) as AssistantResponse);
    } catch {
      if (ticket === latest.current) {
        setError("That search could not be run. Try again.");
        setResult(null);
      }
    } finally {
      if (ticket === latest.current) setPending(false);
    }
  }, []);

  useEffect(() => {
    if (!seedQuestion?.trim()) return;
    void Promise.resolve().then(() => ask(seedQuestion));
  }, [ask, seedQuestion]);

  const chips = result ? chipsFor(result.query) : [];
  const understoodNothing = result != null && result.query.understood.length === 0;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-lg py-md" : "py-lg"}`}>
      {result == null && !pending && error == null ? <AssistantWelcome ask={ask} setQuestion={setQuestion} compact={compact} /> : null}
      {pending ? <p className="text-body-sm text-grey" role="status">Searching your cellar…</p> : null}
      {error ? <p className="rounded-card bg-risk-wash px-md py-sm text-body-sm text-risk-ink" role="alert">{error}</p> : null}
      {result != null && !pending ? <AssistantAnswer result={result} chips={chips} understoodNothing={understoodNothing} onOpenWine={(wineId) => {
        onNavigate?.();
        router.push(`/cellar/${wineId}`);
      }} /> : null}
    </div>

    <form className={`border-t border-rule bg-surface/90 ${compact ? "px-lg py-md" : "sticky bottom-0 px-0 pb-md pt-md"}`} onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <label htmlFor={inputId} className="sr-only">Ask about your inventory</label>
      <div className="glass flex min-h-[56px] items-center gap-sm rounded-card px-md">
        <Search className="h-4 w-4 shrink-0 text-grey" strokeWidth={1.7} aria-hidden />
        <input id={inputId} autoFocus={compact} type="text" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your inventory…" className="min-h-11 min-w-0 flex-1 bg-transparent text-control text-ink placeholder:text-grey focus-ring" />
        <button type="submit" disabled={pending || question.trim() === ""} className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-primary text-seal-ink transition-colors hover:bg-primary-hover disabled:opacity-40 focus-ring" aria-label="Ask">
          <ArrowUp className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </form>
  </div>;
}

function AssistantWelcome({ ask, setQuestion, compact }: {
  ask: (question: string) => Promise<void>;
  setQuestion: (question: string) => void;
  compact: boolean;
}) {
  return <div className={compact ? "" : "mx-auto max-w-[680px]"}>
    <div className="glass rounded-card p-lg">
      <div className="flex items-start gap-sm">
        <ShieldCheck className="mt-2xs h-5 w-5 shrink-0 text-accent" strokeWidth={1.7} aria-hidden />
        <div>
          <h2 className="font-serif text-subheading font-normal text-ink">Grounded in your cellar</h2>
          <p className="mt-xs text-body-sm text-ink-soft">Somm searches inventory and the reference corpus by grape, body, pairing, community rating and price. It does not generate tasting notes or invent stock.</p>
        </div>
      </div>
    </div>
    <p className="mb-sm mt-lg text-caption font-medium uppercase tracking-[0.18em] text-grey">Try asking</p>
    <ul className="grid gap-xs sm:grid-cols-2">{EXAMPLES.map((example) => <li key={example}>
      <button type="button" onClick={() => { setQuestion(example); void ask(example); }} className="glass min-h-11 w-full rounded-card px-md py-sm text-left font-serif text-body-lg text-ink transition-colors hover:border-accent hover:text-accent focus-ring">{example}</button>
    </li>)}</ul>
  </div>;
}

function AssistantAnswer({ result, chips, understoodNothing, onOpenWine }: {
  result: AssistantResponse;
  chips: string[];
  understoodNothing: boolean;
  onOpenWine: (wineId: string) => void;
}) {
  return <div className="mx-auto max-w-[680px]">
    {chips.length > 0 ? <ul className="mb-md flex flex-wrap gap-xs" aria-label="Understood as">{chips.map((chip) => <li key={chip} className="rounded-pill border border-rule-strong px-sm py-2xs text-ledger text-ink-soft">{chip}</li>)}</ul> : null}
    {understoodNothing ? <p className="text-body-sm text-grey">I could not read a wine constraint in that. Try a style, grape, country, price or food — for example “a bold red for lamb”.</p> : null}
    {result.query.unrecognized.length > 0 && !understoodNothing ? <p className="mb-md rounded-card bg-risk-wash px-md py-sm text-body-sm text-risk-ink">I did not understand <strong className="font-medium">{result.query.unrecognized.join(", ")}</strong>, so {result.query.unrecognized.length > 1 ? "those were" : "that was"} left out of this search.</p> : null}
    {result.cellar.length > 0 ? <ResultSection label={`${result.cellarTotal} in your cellar${result.cellarTotal > result.cellar.length ? ` · showing ${result.cellar.length}` : ""}`}>{result.cellar.map((wine) => <li key={wine.wineId}><CellarResult wine={wine} onOpen={() => onOpenWine(wine.wineId)} /></li>)}</ResultSection> : null}
    {result.cellar.length === 0 && !understoodNothing ? <p className="text-body-sm text-grey">Nothing in your cellar matches that.</p> : null}
    {result.corpus.length > 0 ? <ResultSection label="Not in your cellar — reference corpus" className="mt-lg">{result.corpus.map((wine) => <li key={wine.wineId}><CorpusResult wine={wine} /></li>)}</ResultSection> : null}
  </div>;
}

function ResultSection({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <section className={className}><h3 className="mb-sm text-caption font-medium uppercase tracking-[0.18em] text-grey">{label}</h3><ul className="glass overflow-hidden rounded-card">{children}</ul></section>;
}
