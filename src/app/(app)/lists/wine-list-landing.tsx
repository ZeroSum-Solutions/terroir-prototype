"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Files,
  ListOrdered,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ActionDialog } from "@/components/action-dialog";
import type { OverflowMenuItem } from "@/components/overflow-menu";
import { RouteDataEmpty } from "@/components/route-data-state";
import type { WineListWithCount } from "@/lib/wine-list/types";
import { CreateListModal } from "./create-list-modal";
import { ListsMasthead } from "./lists-masthead";
import { useWineListActions } from "./use-wine-list-actions";
import { WineListCard } from "./wine-list-card";

const primaryClassName =
  "flex min-h-11 items-center gap-sm rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring";
const ghostClassName =
  "flex min-h-11 items-center gap-xs rounded-pill border border-rule-strong bg-transparent px-md text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring";

/**
 * SD-12 — every write behind this page is `requireRole(["owner","manager"])`
 * (create, rename/archive/restore, delete, clone), while the page itself is
 * membership-only. Staff used to get the whole armed card footer and learn it
 * was refused only from the 403. `canManage` now gates exactly the controls
 * the API refuses; Copy link, Open and Show archived need no role and stay.
 */
export function WineListLanding({
  lists,
  archivedLists = [],
  showArchived = false,
  canManage,
}: {
  lists: WineListWithCount[];
  archivedLists?: WineListWithCount[];
  showArchived?: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const actions = useWineListActions();
  const { deleteTarget } = actions;

  /**
   * GLOBAL-01 — the card footer's three management actions, demoted.
   *
   * Measured on the running app at 390px (e2e/one-row-rule.test.ts): an
   * archived AND published list showed five controls — Copy link 99px, Open
   * 79px, Clone 81px, Restore 44px, Delete 44px — and the fifth painted at
   * x=[373…417] on a 390px screen, 27px of it past the right edge with no
   * scroll anywhere to reach it. The grid also sizes cards from 280px
   * (`minmax(280px,1fr)`), so those five never fitted a narrow desktop card
   * either; the constraining box here is the CARD, not the viewport, which is
   * why this is not a breakpoint swap.
   *
   * Copy link and Open are the everyday actions and stay in the footer.
   * Clone, Archive/Restore and Delete are management, and go behind the one
   * 44px trigger `src/components/overflow-menu.tsx` exists to be: the row pays
   * one control instead of three. SD-12's role gating is unchanged — a staff
   * member gets no items, and an empty OverflowMenu renders nothing at all.
   */
  const manageActions = (list: WineListWithCount): OverflowMenuItem[] => {
    if (!canManage) return [];
    const items: OverflowMenuItem[] = [
      {
        label: "Clone",
        Icon: Files,
        onSelect: () => actions.cloneList(list),
        disabled: actions.isCloning(list.id),
      },
      {
        label: list.archived ? "Restore" : "Archive",
        Icon: list.archived ? ArchiveRestore : Archive,
        onSelect: () => actions.toggleArchive(list),
        disabled: actions.isArchiving(list.id),
      },
    ];
    // BND-159: delete is offered only once a list is archived.
    if (list.archived) {
      items.push({
        label: "Permanently delete",
        Icon: Trash2,
        onSelect: () => actions.requestDeleteList(list),
        disabled: actions.isDeleting(list.id),
      });
    }
    return items;
  };

  const renderCard = (list: WineListWithCount) => (
    <WineListCard
      key={list.id}
      list={list}
      justCopied={actions.copiedListId === list.id}
      manageActions={manageActions(list)}
      onOpen={() => router.push(`/lists/${list.id}`)}
      onCopyLink={() => actions.copyListLink(list)}
    />
  );

  const noListsAtAll = lists.length === 0 && archivedLists.length === 0;

  return (
    <section>
      <ListsMasthead
        total={lists.length + archivedLists.length}
        published={
          [...lists, ...archivedLists].filter((l) => l.is_published).length
        }
      />

      {(canManage || archivedLists.length > 0) && (
        <div className="mb-lg flex items-center gap-sm md:mb-xl">
          {archivedLists.length > 0 && (
            <a
              href={showArchived ? "/lists" : "/lists?show_archived=1"}
              className={ghostClassName}
            >
              <Archive className="h-4 w-4" strokeWidth={1.9} />
              {showArchived
                ? "Hide archived"
                : `Show archived (${archivedLists.length})`}
            </a>
          )}
          {canManage && (
            <button
              type="button"
              onClick={actions.openCreateModal}
              className={primaryClassName}
            >
              <Plus className="h-4 w-4" strokeWidth={1.9} />
              New wine list
            </button>
          )}
        </div>
      )}

      {actions.error && deleteTarget === null && (
        <div
          role="alert"
          className="mb-md flex items-start justify-between gap-sm rounded-card border border-risk-ink/30 bg-risk-wash px-sm py-xs text-body-sm text-risk-ink"
        >
          <span>{actions.error}</span>
          <button
            type="button"
            onClick={actions.dismissError}
            aria-label="Dismiss error"
            className="-mr-2xs flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-pill text-risk-ink/70 hover:text-risk-ink focus-ring"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      )}

      {noListsAtAll ? (
        <RouteDataEmpty
          icon={<ListOrdered className="h-6 w-6" strokeWidth={1.6} />}
          title={canManage ? "Create your first wine list" : "No wine lists yet"}
          description={
            canManage
              ? "Your guests will thank you."
              : "A manager creates the lists; they will show up here."
          }
          action={
            canManage ? (
              <button
                type="button"
                onClick={actions.openCreateModal}
                className={`${primaryClassName} inline-flex`}
              >
                <Plus className="h-4 w-4" strokeWidth={1.9} />
                New wine list
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Active lists */}
          {lists.length > 0 && (
            <div className="grid gap-md md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
              {lists.map(renderCard)}
              {canManage && (
                <button
                  type="button"
                  onClick={actions.openCreateModal}
                  className="flex flex-col items-center justify-center gap-sm rounded-card border border-dashed border-rule-strong p-xl text-center text-grey transition-colors hover:border-accent hover:text-accent focus-ring"
                >
                  <Plus className="h-5 w-5" strokeWidth={1.9} />
                  <span className="text-control font-medium">
                    Create a new list
                  </span>
                  <span className="text-ledger">
                    Start from scratch or a template
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Archived lists (shown when toggled) */}
          {showArchived && archivedLists.length > 0 && (
            <div className="mt-xl">
              <h2 className="mb-md text-caption font-medium uppercase tracking-[0.18em] text-grey">
                Archived
              </h2>
              <div className="grid gap-md md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                {archivedLists.map(renderCard)}
              </div>
            </div>
          )}

          {/* All lists are archived, none active */}
          {lists.length === 0 && !showArchived && archivedLists.length > 0 && (
            <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-rule-strong px-lg py-3xl text-center">
              <Archive className="mb-md h-10 w-10 text-grey" strokeWidth={1.6} />
              <p className="font-serif text-subheading font-normal text-ink">
                All wine lists are archived
              </p>
              <p className="mt-xs text-body-sm text-ink-soft">
                Restore them or create a new one.
              </p>
              <Link
                href="/lists?show_archived=1"
                className={`${ghostClassName} mt-lg inline-flex`}
              >
                <Archive className="h-4 w-4" strokeWidth={1.9} />
                Show archived lists
              </Link>
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      {actions.showModal && (
        <CreateListModal
          newName={actions.newName}
          setNewName={actions.changeNewName}
          newDescription={actions.newDescription}
          setNewDescription={actions.changeNewDescription}
          creating={actions.creating}
          error={actions.createError}
          onClose={actions.closeCreateModal}
          onCreate={actions.createList}
        />
      )}

      <ActionDialog
        open={deleteTarget !== null}
        title="Permanently delete list"
        description={
          deleteTarget?.is_published
            ? `Permanently delete "${deleteTarget.name}"? This list is currently published — its public link will stop working immediately. This cannot be undone.`
            : deleteTarget
              ? `Permanently delete "${deleteTarget.name}"? Its sections and items will be removed. This cannot be undone.`
              : ""
        }
        confirmLabel="Permanently delete list"
        busy={actions.isDeleteBusy}
        onClose={actions.dismissDeleteTarget}
        onConfirm={actions.deleteList}
      >
        {actions.error && (
          <p
            role="alert"
            className="rounded-card border border-risk-ink/30 bg-risk-wash px-sm py-xs text-body-sm text-risk-ink"
          >
            {actions.error}
          </p>
        )}
      </ActionDialog>
    </section>
  );
}
