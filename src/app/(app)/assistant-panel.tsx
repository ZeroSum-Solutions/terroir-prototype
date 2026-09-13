"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, MoveUpRight, X } from "lucide-react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { AssistantExperience } from "./assistant-experience";
import { onAssistantRequest } from "./assistant-open";

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  useEffect(() => onAssistantRequest((question) => {
    setSeed(question);
    setOpen(true);
  }), []);

  return <>
    <button type="button" onClick={() => { setSeed(null); setOpen(true); }} aria-haspopup="dialog" aria-label="Ask Somm" className="grid h-11 w-11 place-items-center rounded-pill text-ink transition-colors hover:text-accent focus-ring">
      <MessageCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
    </button>
    {open ? <AssistantDialog key={seed ?? ""} seedQuestion={seed} onClose={() => setOpen(false)} /> : null}
  </>;
}

function AssistantDialog({ seedQuestion, onClose }: { seedQuestion: string | null; onClose: () => void }) {
  const titleId = useId();
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef: trapRef, onEscape: onClose });
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-end justify-center bg-scrim md:items-center md:p-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={trapRef} className="glass flex max-h-[min(82dvh,760px)] w-full flex-col overflow-hidden rounded-t-[28px] border-x-0 border-b-0 md:max-w-[620px] md:rounded-card md:border">
        <header className="flex items-center gap-sm border-b border-rule px-lg py-md">
          <span className="h-7 w-7 rounded-pill bg-[linear-gradient(160deg,#A32330,#5C121C)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-serif text-subheading font-normal text-ink">Somm</h2>
            <p className="text-ledger text-grey">Searching your cellar</p>
          </div>
          <Link href="/somm" onClick={onClose} className="inline-flex min-h-11 items-center gap-2xs px-xs text-body-sm text-accent focus-ring">
            Full chat <MoveUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-pill text-grey hover:text-ink focus-ring">
            <X className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          </button>
        </header>
        <AssistantExperience seedQuestion={seedQuestion} onNavigate={onClose} compact />
      </div>
    </div>,
    document.body,
  );
}
