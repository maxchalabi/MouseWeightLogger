import { adminClient, deviceNameFor, handle, HttpError, json, requireUser, requireUuid } from "../_shared/http.ts";

Deno.serve((req) =>
  handle(req, async (request) => {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const id = requireUuid(body.id, "Colony");
    const name = cleanName(body.name);
    const admin = adminClient();

    const { data: existing } = await admin.from("colonies").select("id, name").eq("id", id).maybeSingle();
    if (existing) {
      const { data: member } = await admin
        .from("colony_members")
        .select("role, revoked_at")
        .eq("colony_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!member || member.role !== "owner" || member.revoked_at) {
        throw new HttpError("That colony already exists.", 409);
      }
      return json({ id, name: existing.name, role: "owner" });
    }

    const { error: colonyError } = await admin.from("colonies").insert({ id, name });
    if (colonyError) throw new HttpError(colonyError.message);

    const { error: memberError } = await admin.from("colony_members").insert({
      colony_id: id,
      user_id: user.id,
      role: "owner",
      device_name: await deviceNameFor(admin, user.id),
    });
    if (memberError) throw new HttpError(memberError.message);

    return json({ id, name, role: "owner" });
  }),
);

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) throw new HttpError("Colony name is required.");
  return name;
}
