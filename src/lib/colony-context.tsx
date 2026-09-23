import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getActiveColony, getDb, listColonies, setActiveColony } from "./db";
import { ensureDeviceSession, subscribeChanges, syncColony, syncConfigured } from "./sync";
import type { Colony } from "./types";

export type SyncStatus = "local" | "syncing" | "synced" | "error";

type ColonyContextValue = {
  colonies: Colony[];
  active: Colony | null;
  canEdit: boolean;
  revision: number;
  syncStatus: SyncStatus;
  syncError: string | null;
  refresh: (bump?: boolean) => Promise<void>;
  selectColony: (id: string) => Promise<void>;
};

const ColonyContext = createContext<ColonyContextValue | null>(null);

export function ColonyProvider({ children }: { children: ReactNode }) {
  const [colonies, setColonies] = useState<Colony[]>([]);
  const [active, setActive] = useState<Colony | null>(null);
  const [revision, setRevision] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(bump = false) {
    const list = await listColonies();
    const current = await getActiveColony();
    setColonies(list);
    setActive(current);
    if (bump) setRevision((value) => value + 1);
  }

  async function selectColony(id: string) {
    await setActiveColony(id);
    await refresh(true);
  }

  useEffect(() => {
    void getDb()
      .then(() => refresh())
      .then(() => setReady(true))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!active?.shared) {
      setSyncStatus("local");
      setSyncError(null);
      return;
    }
    if (!syncConfigured()) {
      setSyncStatus("error");
      setSyncError(null);
      return;
    }

    let cancel = false;
    let unsubscribe: () => void = () => undefined;
    const run = async () => {
      if (cancel) return;
      setSyncStatus((current) => (current === "synced" ? current : "syncing"));
      try {
        const changed = await syncColony(active.id);
        if (cancel) return;
        const list = await listColonies();
        const current = await getActiveColony();
        setColonies(list);
        setActive(current);
        setSyncStatus(current?.shared ? "synced" : "local");
        setSyncError(null);
        if (changed) setRevision((value) => value + 1);
      } catch (err) {
        if (cancel) return;
        setSyncStatus("error");
        setSyncError(plainSyncError(err));
        const list = await listColonies().catch(() => null);
        const current = await getActiveColony().catch(() => null);
        if (list) setColonies(list);
        if (current) setActive(current);
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), 20000);
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    void ensureDeviceSession()
      .then(() => {
        if (cancel) return;
        unsubscribe = subscribeChanges(() => void run());
      })
      .catch(() => undefined);

    return () => {
      cancel = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [active?.id, active?.shared]);

  if (error) {
    return (
      <p className="m-6 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
        Could not open the local database. {error}
      </p>
    );
  }
  if (!ready) {
    return <p className="m-6 text-sm text-muted">Opening the colony log…</p>;
  }

  return (
    <ColonyContext.Provider
      value={{
        colonies,
        active,
        canEdit: active?.role === "owner",
        revision,
        syncStatus,
        syncError,
        refresh,
        selectColony,
      }}
    >
      {children}
    </ColonyContext.Provider>
  );
}

export function useColony(): ColonyContextValue {
  const value = useContext(ColonyContext);
  if (!value) throw new Error("Colony sync is not ready.");
  return value;
}

export function useActiveColony(): ColonyContextValue & { active: Colony } {
  const value = useColony();
  if (!value.active) throw new Error("No colony is selected.");
  return { ...value, active: value.active };
}

function plainSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("VITE_SUPABASE")) return "The shared colony could not be reached.";
  return message;
}
