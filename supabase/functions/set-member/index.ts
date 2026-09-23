import { adminClient, handle, HttpError, json, requireUser, requireUuid } from "../_shared/http.ts";

Deno.serve((req) =>
  handle(req, async (request) => {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const admin = adminClient();
    const deviceName = cleanName(body.device_name);

    if (deviceName && !body.colony_id) {
      await admin.from("devices").update({ name: deviceName }).eq("auth_user_id", user.id);
      const { error } = await admin
        .from("colony_members")
        .update({ device_name: deviceName, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("revoked_at", null);
      if (error) throw new HttpError(error.message);
      return json({ ok: true });
    }

    const colonyId = requireUuid(body.colony_id, "Colony");
    const targetId = requireUuid(body.user_id, "Device");
    const role = body.role;
    if (role !== "owner" && role !== "watcher" && role !== "revoke") {
      throw new HttpError("Choose owner, watcher, or remove.");
    }

    const { data: actor } = await admin
      .from("colony_members")
      .select("role, revoked_at")
      .eq("colony_id", colonyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!actor) throw new HttpError("You are not in this colony.", 403);

    const selfLeave = targetId === user.id && role === "revoke";
    if (actor.revoked_at) {
      if (selfLeave) {
        await deleteColonyIfAbandoned(admin, colonyId);
        return json({ ok: true });
      }
      throw new HttpError("You are not in this colony.", 403);
    }
    if (!selfLeave && (actor.role !== "owner" || actor.revoked_at)) {
      throw new HttpError("Only an owner can change devices.", 403);
    }

    const { data: target } = await admin
      .from("colony_members")
      .select("role, revoked_at")
      .eq("colony_id", colonyId)
      .eq("user_id", targetId)
      .maybeSingle();
    if (!target || target.revoked_at) throw new HttpError("That device is not in this colony.");

    const removesOwner = target.role === "owner" && role !== "owner";
    if (removesOwner && !selfLeave) {
      const { count, error: countError } = await admin
        .from("colony_members")
        .select("user_id", { count: "exact", head: true })
        .eq("colony_id", colonyId)
        .eq("role", "owner")
        .is("revoked_at", null)
        .neq("user_id", targetId);
      if (countError) throw new HttpError(countError.message);
      if (!count) {
        throw new HttpError("You are the only owner. Invite another owner before leaving.");
      }
    }

    const now = new Date().toISOString();
    const patch =
      role === "revoke"
        ? { revoked_at: now, updated_at: now }
        : { role, revoked_at: null, updated_at: now };
    const { error } = await admin
      .from("colony_members")
      .update(patch)
      .eq("colony_id", colonyId)
      .eq("user_id", targetId);
    if (error) throw new HttpError(error.message);
    if (role === "revoke") await deleteColonyIfAbandoned(admin, colonyId);
    return json({ ok: true });
  }),
);

async function deleteColonyIfAbandoned(
  admin: ReturnType<typeof adminClient>,
  colonyId: string,
): Promise<void> {
  const { count, error: countError } = await admin
    .from("colony_members")
    .select("user_id", { count: "exact", head: true })
    .eq("colony_id", colonyId)
    .is("revoked_at", null);
  if (countError) throw new HttpError(countError.message);
  if (count !== 0) return;

  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from("photos").list(colonyId, { limit: 100, offset });
    if (error) throw new HttpError(error.message);
    if (!data?.length) break;
    for (const file of data) {
      if (file.name) paths.push(`${colonyId}/${file.name}`);
    }
    if (data.length < 100) break;
  }
  if (paths.length) {
    const { error } = await admin.storage.from("photos").remove(paths);
    if (error) throw new HttpError(error.message);
  }

  const { error } = await admin.from("colonies").delete().eq("id", colonyId);
  if (error) throw new HttpError(error.message);
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim();
  if (!name || name.length > 80) return "";
  return name;
}
