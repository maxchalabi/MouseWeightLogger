import { adminClient, handle, HttpError, json, requireUser, requireUuid } from "../_shared/http.ts";
import { generateCode, hashCode, requireRole } from "../_shared/invite.ts";

Deno.serve((req) =>
  handle(req, async (request) => {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const colonyId = requireUuid(body.colony_id, "Colony");
    let role: "owner" | "watcher";
    try {
      role = requireRole(body.role);
    } catch (error) {
      throw new HttpError(error instanceof Error ? error.message : "Role must be owner or watcher.");
    }

    const admin = adminClient();
    await assertOwner(admin, colonyId, user.id);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from("invites").insert({
      colony_id: colonyId,
      role,
      code_hash: await hashCode(code),
      created_by: user.id,
      expires_at: expiresAt,
    });
    if (error) throw new HttpError(error.message);

    return json({ code, expires_at: expiresAt, role });
  }),
);

async function assertOwner(
  admin: ReturnType<typeof adminClient>,
  colonyId: string,
  userId: string,
): Promise<void> {
  const { data } = await admin
    .from("colony_members")
    .select("role, revoked_at")
    .eq("colony_id", colonyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.role !== "owner" || data.revoked_at) {
    throw new HttpError("Only an owner can invite someone.", 403);
  }
}
