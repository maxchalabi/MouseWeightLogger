import { useState } from "react";
import { Colony } from "./components/Colony";
import { AddColonyDrawer, ColonyEditDrawer } from "./components/ColoniesPanel";
import { Curves } from "./components/Curves";
import { Today } from "./components/Today";
import { ColonyProvider, useColony, type SyncStatus } from "./lib/colony-context";
import type { Colony as ColonyRecord } from "./lib/types";

type View = "today" | "colony" | "curves";
type Panel = { kind: "add" } | { kind: "edit"; id: string } | null;

const NAV: { id: View; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "colony", label: "Mice" },
  { id: "curves", label: "Curves" },
];

const SYNC_DOT: Record<SyncStatus, string> = {
  local: "bg-muted",
  syncing: "bg-accent",
  synced: "bg-ok",
  error: "bg-bad",
};

export default function App() {
  return (
    <ColonyProvider>
      <Shell />
    </ColonyProvider>
  );
}

function Shell() {
  const [view, setView] = useState<View>("today");
  const [panel, setPanel] = useState<Panel>(null);
  const { colonies, active, syncStatus, selectColony } = useColony();

  function openEdit(id: string) {
    void selectColony(id);
    setPanel({ kind: "edit", id });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(232,184,109,0.07),_transparent_55%)]" />
      <header className="relative z-10 flex items-center gap-4 border-b border-line px-5 py-3">
        <span className="shrink-0 font-serif text-xl tracking-tight">MouseWeightLogger</span>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {colonies.map((colony) => (
            <ColonyPill
              key={colony.id}
              colony={colony}
              active={colony.id === active?.id}
              syncStatus={colony.id === active?.id ? syncStatus : "local"}
              onSelect={() => {
                void selectColony(colony.id);
                setPanel(null);
              }}
              onEdit={() => openEdit(colony.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => setPanel({ kind: "add" })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-lg leading-none text-muted hover:text-ink"
            aria-label="Add a colony"
          >
            +
          </button>
        </div>
        <nav className="flex shrink-0 gap-1 rounded-full border border-line bg-panel p-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`rounded-full px-4 py-1.5 text-sm ${
                view === item.id ? "bg-accent text-bg" : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-auto px-5 py-6">
        {!active ? (
          <div className="mx-auto max-w-lg pt-16 text-center">
            <p className="font-serif text-3xl">No colony on this computer</p>
            <p className="mt-2 text-sm text-muted">Create one, or join with a code from another computer.</p>
            <button
              type="button"
              onClick={() => setPanel({ kind: "add" })}
              className="mt-6 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg"
            >
              Add a colony
            </button>
          </div>
        ) : (
          <>
            {view === "today" && <Today onOpenColony={() => setView("colony")} />}
            {view === "colony" && <Colony />}
            {view === "curves" && <Curves />}
          </>
        )}
      </main>
      {panel?.kind === "add" && <AddColonyDrawer onClose={() => setPanel(null)} />}
      {panel?.kind === "edit" && (
        <ColonyEditDrawer colonyId={panel.id} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

function ColonyPill({
  colony,
  active,
  syncStatus,
  onSelect,
  onEdit,
}: {
  colony: ColonyRecord;
  active: boolean;
  syncStatus: SyncStatus;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={`flex shrink-0 items-center rounded-full border ${
        active ? "border-accent bg-accent/10" : "border-line bg-panel"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-2 py-1 pl-3 pr-1 text-sm"
      >
        {colony.shared && <span className={`h-2 w-2 rounded-full ${SYNC_DOT[syncStatus]}`} />}
        <span className="max-w-36 truncate">{colony.name}</span>
        {colony.role === "watcher" && <span className="text-xs text-muted">View</span>}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="mr-1 rounded-full p-1.5 text-muted hover:text-ink"
        aria-label={`Edit ${colony.name}`}
      >
        <PencilIcon />
      </button>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4.5L19.2 9.3a1.8 1.8 0 0 0 0-2.5l-1.9-1.9a1.8 1.8 0 0 0-2.5 0L4 15.5V20Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
