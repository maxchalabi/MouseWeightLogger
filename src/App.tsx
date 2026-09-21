import { useEffect, useState } from "react";
import { Colony } from "./components/Colony";
import { Curves } from "./components/Curves";
import { Today } from "./components/Today";
import { getDb } from "./lib/db";

type View = "today" | "colony" | "curves";

const NAV: { id: View; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "colony", label: "Mice" },
  { id: "curves", label: "Curves" },
];

export default function App() {
  const [view, setView] = useState<View>("today");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getDb()
      .then(() => setReady(true))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(232,184,109,0.07),_transparent_55%)]" />
      <header className="relative z-10 flex items-center justify-between border-b border-line px-5 py-3">
        <span className="font-serif text-xl tracking-tight">MouseWeightLogger</span>
        <nav className="flex gap-1 rounded-full border border-line bg-panel p-1">
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
        {!ready && !error && <p className="text-sm text-muted">Opening the colony log…</p>}
        {error && (
          <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
            Could not open the local database. {error}
          </p>
        )}
        {ready && view === "today" && <Today onOpenColony={() => setView("colony")} />}
        {ready && view === "colony" && <Colony />}
        {ready && view === "curves" && <Curves />}
      </main>
    </div>
  );
}
