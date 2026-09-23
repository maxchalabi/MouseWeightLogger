import { useEffect, useState, type ReactNode } from "react";
import { useColony } from "../lib/colony-context";
import { createLocalColony, getDeviceName } from "../lib/db";
import {
  createInvite,
  currentUserId,
  joinColony,
  listMembers,
  publishDeviceName,
  removeColonyFromThisComputer,
  renameSharedColony,
  setMember,
  shareColony,
} from "../lib/sync";
import type { Colony, ColonyMember, ColonyRole } from "../lib/types";

type Invite = { code: string; role: ColonyRole };

function Drawer({
  kicker,
  title,
  onClose,
  children,
}: {
  kicker: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]">
      <button className="h-full flex-1 cursor-default" onClick={onClose} aria-label="Close" />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">{kicker}</p>
            <h2 className="font-serif text-3xl">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">
            Close
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}

export function AddColonyDrawer({ onClose }: { onClose: () => void }) {
  const { refresh } = useColony();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer kicker="Colony" title="Add" onClose={onClose}>
      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await createLocalColony(name);
            await refresh(true);
          });
        }}
      >
        <p className="text-xs uppercase tracking-[0.18em] text-muted">On this computer</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Colony name"
          className="field"
          aria-label="New colony name"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
        >
          Create colony
        </button>
      </form>
      <form
        className="space-y-3 border-t border-line pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await joinColony(code);
            await refresh(true);
          });
        }}
      >
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Join with a code</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Invite code"
          className="field uppercase tracking-widest"
          aria-label="Invite code"
        />
        <button
          type="submit"
          disabled={busy || code.replace(/[^A-Z0-9]/g, "").length < 8}
          className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-50"
        >
          Join colony
        </button>
      </form>
    </Drawer>
  );
}

export function ColonyEditDrawer({ colonyId, onClose }: { colonyId: string; onClose: () => void }) {
  const { colonies, refresh, syncError } = useColony();
  const colony = colonies.find((item) => item.id === colonyId) ?? null;
  const canEdit = colony?.role === "owner";

  const [colonyName, setColonyName] = useState(colony?.name ?? "");
  const [deviceName, setDeviceName] = useState("");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [members, setMembers] = useState<ColonyMember[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [lastComputer, setLastComputer] = useState<boolean | null>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setColonyName(colony?.name ?? "");
  }, [colony?.name]);

  useEffect(() => {
    void getDeviceName().then(setDeviceName);
    void currentUserId().then(setMe);
  }, []);

  useEffect(() => {
    if (!colony?.shared) {
      setMembers([]);
      return;
    }
    void listMembers(colony.id)
      .then(async (rows) => {
        setMembers(rows);
        setMe(await currentUserId());
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [colony?.id, colony?.shared, colony?.role]);

  if (!colony) return null;

  async function run(action: () => Promise<void>, ok?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (ok) setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function inviteAs(role: ColonyRole, current: Colony) {
    if (!current.shared) await shareColony(current.id);
    const next = await createInvite(current.id, role);
    setInvite({ code: next.code, role: next.role });
    await refresh(true);
  }

  return (
    <Drawer kicker="Colony" title={colony.name} onClose={onClose}>
      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {notice && <p className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}
      {syncError && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{syncError}</p>}

      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await renameSharedColony(colony.id, colonyName);
              await refresh();
            }, "Name saved.");
          }}
        >
          <input
            value={colonyName}
            onChange={(e) => setColonyName(e.target.value)}
            className="field"
            aria-label="Colony name"
          />
          <button
            type="submit"
            disabled={busy || !colonyName.trim() || colonyName.trim() === colony.name}
            className="shrink-0 rounded-full border border-line px-3 text-sm disabled:opacity-50"
          >
            Save
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">You can view this colony.</p>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted">
        Name other computers see
        <input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          onBlur={() => {
            if (!deviceName.trim()) return;
            void run(() => publishDeviceName(deviceName));
          }}
          className="field"
        />
      </label>

      {canEdit && (
        <section className="space-y-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Share</p>
          <p className="text-sm text-muted">
            {colony.shared
              ? "Send a code to another computer. Each code works once."
              : "Sharing creates a code another computer can join."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => inviteAs("owner", colony), "Owner code ready.")}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
            >
              Invite an owner
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => inviteAs("watcher", colony), "Watcher code ready.")}
              className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-50"
            >
              Invite a watcher
            </button>
          </div>
          {invite && (
            <div className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted">
                {invite.role === "owner" ? "Owner" : "Watcher"} code · one use · 7 days
              </p>
              <p className="mt-1 font-serif text-3xl tracking-[0.18em]">{invite.code}</p>
              <button
                type="button"
                className="mt-2 text-xs text-muted hover:text-ink"
                onClick={() => void navigator.clipboard.writeText(invite.code).catch(() => undefined)}
              >
                Copy code
              </button>
            </div>
          )}
        </section>
      )}

      {canEdit && colony.shared && members.length > 0 && (
        <MemberList
          members={members}
          me={me}
          busy={busy}
          onRole={(userId, role) =>
            void run(async () => {
              await setMember(colony.id, userId, role);
              setMembers(await listMembers(colony.id));
              await refresh(true);
            })
          }
          onRemove={(userId) =>
            void run(async () => {
              await setMember(colony.id, userId, "revoke");
              setMembers(await listMembers(colony.id));
            }, "Device removed.")
          }
        />
      )}

      <section className="border-t border-line pt-4">
        {confirmRemove ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">{removeWarning(colony.name, colony.shared, lastComputer)}</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await removeColonyFromThisComputer(colony.id);
                    await refresh(true);
                    onClose();
                  })
                }
                className="rounded-full bg-bad px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
              >
                Remove
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(false)}
                className="rounded-full border border-line px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!colony.shared) {
                  setLastComputer(false);
                } else {
                  try {
                    const rows = await listMembers(colony.id);
                    const userId = me ?? (await currentUserId());
                    setMembers(rows);
                    setMe(userId);
                    setLastComputer(userId ? rows.every((member) => member.user_id === userId) : null);
                  } catch {
                    setLastComputer(null);
                  }
                }
                setConfirmRemove(true);
              })
            }
            className="text-sm text-bad disabled:opacity-50"
          >
            Remove from this computer
          </button>
        )}
      </section>
    </Drawer>
  );
}

function removeWarning(name: string, shared: boolean, lastComputer: boolean | null): string {
  if (!shared) {
    return `Remove ${name} from this computer? The mice and weights stored here will be deleted.`;
  }
  if (lastComputer) {
    return `This is the last computer with ${name}. Removing it deletes the colony everywhere, not only here.`;
  }
  if (lastComputer === false) {
    return `Remove ${name} from this computer? Other computers that still have it keep their copy.`;
  }
  return `Remove ${name} from this computer? If no other computer still has it, the colony is deleted everywhere.`;
}

function MemberList({
  members,
  me,
  busy,
  onRole,
  onRemove,
}: {
  members: ColonyMember[];
  me: string | null;
  busy: boolean;
  onRole: (userId: string, role: ColonyRole) => void;
  onRemove: (userId: string) => void;
}) {
  const owners = members.filter((member) => member.role === "owner");
  return (
    <ul className="space-y-2">
      {members.map((member) => {
        const mine = member.user_id === me;
        const lastOwner = mine && member.role === "owner" && owners.length === 1;
        return (
          <li
            key={member.user_id}
            className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2"
          >
            <span>
              <span className="block text-sm">
                {member.device_name}
                {mine ? " · this computer" : ""}
              </span>
              <span className="text-xs text-muted">{member.role === "owner" ? "Owner" : "Watcher"}</span>
            </span>
            {!mine && (
              <span className="flex items-center gap-2">
                <select
                  value={member.role}
                  disabled={busy || !me}
                  onChange={(e) => onRole(member.user_id, e.target.value as ColonyRole)}
                  className="bg-transparent text-xs text-ink outline-none"
                  aria-label={`Role for ${member.device_name}`}
                >
                  <option value="owner">Owner</option>
                  <option value="watcher">Watcher</option>
                </select>
                <button
                  type="button"
                  disabled={busy || !me || (member.role === "owner" && owners.length === 1)}
                  onClick={() => onRemove(member.user_id)}
                  className="text-xs text-bad disabled:opacity-40"
                >
                  Remove
                </button>
              </span>
            )}
            {lastOwner && <span className="text-xs text-muted">Only owner</span>}
          </li>
        );
      })}
    </ul>
  );
}
