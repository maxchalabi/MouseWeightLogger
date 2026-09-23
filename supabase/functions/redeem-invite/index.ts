import { adminClient, deviceNameFor, handle, HttpError, json, requireUser } from "../_shared/http.ts";
import { hashCode, normalizeCode } from "../_shared/invite.ts";

Deno.serve((req) =>
  handle(req, async (request) => {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : "";
    if (normalizeCode(code).length < 8) throw new HttpError("Enter the full invite code.");

    const admin = adminClient();
    const codeHash = await hashCode(code);
    const now = new Date().toISOString();
    const { data: invite } = await admin
      .from("invites")
      .select("id, colony_id, role, expires_at, redeemed_at")
      .eq("code_hash", codeHash)
      .is("redeemed_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    if (!invite) throw new HttpError("That code is used up, expired, or not recognized.");

    const { data: colony } = await admin.from("colonies").select("id, name").eq("id", invite.colony_id).maybeSingle();
    if (!colony) throw new HttpError("That colony is no longer available.");

    const { data: redeemed } = await admin
      .from("invites")
      .update({ redeemed_by: user.id, redeemed_at: now })
      .eq("id", invite.id)
      .is("redeemed_at", null)
      .select("id")
      .maybeSingle();
    if (!redeemed) throw new HttpError("That code was just used.");

    const { error: memberError } = await admin.from("colony_members").upsert(
      {
        colony_id: invite.colony_id,
        user_id: user.id,
        role: invite.role,
        device_name: await deviceNameFor(admin, user.id),
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: "colony_id,user_id" },
    );
    if (memberError) throw new HttpError(memberError.message);

    return json({ colony_id: colony.id, name: colony.name, role: invite.role });
  }),
);
