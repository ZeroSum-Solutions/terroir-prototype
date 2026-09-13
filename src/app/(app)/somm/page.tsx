import type { Metadata } from "next";
import { AssistantExperience } from "../assistant-experience";

export const metadata: Metadata = { title: "Somm" };

export default function SommPage() {
  return <section className="mx-auto flex min-h-[calc(100dvh-var(--chrome-header-total)-var(--chrome-tabbar-total)-8rem)] max-w-[760px] flex-col">
    <div className="dawn-gradient relative -mx-md -mt-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:px-lg md:pb-xl md:pt-2xl">
      <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">Cellar intelligence</p>
      <h1 className="mt-xs font-serif text-heading font-normal leading-none text-ink lg:text-display">Somm</h1>
      <p className="mt-sm max-w-[560px] text-body text-ink-soft">Find a bottle by the facts recorded in your cellar.</p>
    </div>
    <AssistantExperience />
  </section>;
}
