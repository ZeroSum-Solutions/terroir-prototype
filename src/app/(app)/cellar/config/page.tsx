"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { normalizeSections, type CellarSection as Section } from "../sections";
import { SortableSectionItem } from "./sortable-section-item";

function generateId(): string {
  return crypto.randomUUID();
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = [...array];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export default function CellarConfigPage() {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [sections, setSections] = useState<Section[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Section | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap({
    containerRef: deleteDialogRef,
    onEscape: () => { if (!saving.current) setDeleteTarget(null); },
    enabled: deleteTarget !== null,
  });

  const [newName, setNewName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const res = await fetch("/api/cellar/config");
        if (!res.ok) throw new Error("Failed to load config.");
        const config = await res.json();
        if (cancelled) return;
        if (config?.labels?.sections && Array.isArray(config.labels.sections)) {
          setSections(normalizeSections(config.labels.sections));
        }
        setLoadSucceeded(true);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load.");
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const save = useCallback(
    async (updated: Section[]) => {
      if (saving.current || !loadSucceeded) return false;
      saving.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/cellar/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sections: updated,
            section_order: updated.map((s) => s.id),
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
          throw new Error(typeof message === "string" ? message : "Failed to save.");
        }
        setSections(updated);
        startTransition(() => router.refresh());
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed.");
        return false;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [router, loadSucceeded],
  );

  const addSection = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    const updated = [...sections, { id: generateId(), name }];
    if (await save(updated)) setNewName("");
  }, [newName, sections, save]);

  const startEdit = useCallback((section: Section) => {
    if (saving.current) return;
    setEditingId(section.id);
    setEditName(section.name);
  }, []);

  const commitEdit = useCallback(
    async (id: string) => {
      if (saving.current) return;
      const name = editName.trim();
      if (!name) {
        setEditingId(null);
        return;
      }
      const updated = sections.map((s) =>
        s.id === id ? { ...s, name } : s,
      );
      if (await save(updated)) setEditingId(null);
    },
    [editName, sections, save],
  );

  const cancelEdit = useCallback(() => {
    if (saving.current) return;
    setEditingId(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const updated = sections.filter((s) => s.id !== deleteTarget.id);
    if (await save(updated)) setDeleteTarget(null);
  }, [deleteTarget, sections, save]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sections, oldIndex, newIndex);
      void save(reordered);
    },
    [sections, save],
  );

  const moveSectionWithKeyboard = useCallback(
    (id: string, direction: -1 | 1) => {
      const oldIndex = sections.findIndex((section) => section.id === id);
      const newIndex = oldIndex + direction;
      if (oldIndex === -1 || newIndex < 0 || newIndex >= sections.length) return;

      const reordered = arrayMove(sections, oldIndex, newIndex);
      void save(reordered);
    },
    [sections, save],
  );

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[480px] px-md py-lg">
      <div className="mb-lg flex items-start gap-sm">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back to cellar"
          className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-ink-soft hover:text-ink focus-ring"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={1.9} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
            Cellar · Sections ·{" "}
            <span className="tabular">{sections.length}</span>
          </p>
          <h1 className="mt-xs font-serif text-heading-sm font-normal leading-[1.05] tracking-[-0.02em] text-ink md:text-heading">Cellar Sections</h1>
          <p className="mt-xs text-body-sm text-ink-soft">
            Organize your cellar into named groups like Reds by Region or Cult
            Cabs.
          </p>
        </div>
      </div>

      {error && !deleteTarget && (
        <div
          role="alert"
          className="mb-md rounded-card border border-risk-ink/30 bg-risk-wash px-md py-sm text-body-sm text-risk-ink"
        >
          {error}
        </div>
      )}
      {!loadSucceeded && (
        <button type="button" className="mb-md min-h-11 rounded-pill border border-rule px-md text-control focus-ring"
          onClick={() => { setLoaded(false); setLoadAttempt((value) => value + 1); }}>
          Retry loading sections
        </button>
      )}

      {sections.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mb-lg divide-y divide-rule border-y border-rule">
              {sections.map((section) => (
                <SortableSectionItem
                  key={section.id}
                  section={section}
                  editingId={editingId}
                  editName={editName}
                  busy={busy}
                  onStartEdit={startEdit}
                  onChangeEditName={setEditName}
                  onCommitEdit={commitEdit}
                  onCancelEdit={cancelEdit}
                  onDelete={(section) => { setError(null); setDeleteTarget(section); }}
                  onKeyboardMove={moveSectionWithKeyboard}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : loadSucceeded ? (
        <p className="mb-lg rounded-card card-surface px-md py-lg text-center text-control text-grey">
          No sections yet. Add your first one below.
        </p>
      ) : null}

      <div className="flex gap-xs">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addSection();
          }}
          placeholder="New section name (e.g. Reds by Region)"
          aria-label="New section name"
          className="glass min-w-0 flex-1 rounded-pill px-sm py-sm text-control text-ink placeholder:text-grey focus-ring"
          disabled={busy || !loadSucceeded}
        />
        <button
          type="button"
          onClick={addSection}
          disabled={busy || !loadSucceeded || !newName.trim()}
          className={cn(
            "flex h-[44px] shrink-0 items-center gap-xs rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors",
            "hover:bg-primary-hover disabled:opacity-60 focus-ring",
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          Add
        </button>
      </div>

      {deleteTarget && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop-click-to-dismiss is a mouse-only convenience; the dialog below has full keyboard access via useFocusTrap (Escape + a Cancel button).
        <div
          className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-scrim"
          onClick={() => { if (!saving.current) setDeleteTarget(null); }}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- onClick here only stops the backdrop's dismiss-click from bubbling; no independent interaction to reach by keyboard. */}
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-section-heading"
            className="glass mx-md w-full max-w-[420px] rounded-card p-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-section-heading"
              className="font-serif text-subheading font-normal text-ink"
            >
              Delete section?
            </h3>
            <p className="mt-sm text-control text-ink-soft">
              This will permanently remove &ldquo;{deleteTarget.name}&rdquo;.
            </p>
            {error && <p role="alert" className="mt-sm text-control text-risk-ink">{error}</p>}
            <div className="mt-lg flex gap-sm">
              <button
                type="button"
                onClick={() => { if (!saving.current) setDeleteTarget(null); }}
                disabled={busy}
                className="min-h-11 flex-1 rounded-pill border border-rule-strong bg-transparent px-md py-sm text-control font-medium text-ink hover:bg-wash disabled:opacity-60 focus-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy}
                className="min-h-11 flex-1 rounded-pill bg-primary px-md py-sm text-control font-semibold text-seal-ink hover:bg-primary-hover disabled:opacity-60 focus-ring"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
