import { adminClient, handle, HttpError, json, requireUuid } from "../_shared/http.ts";

const DEVICE_EMAIL_DOMAIN = "devices.mouseweight.invalid";

Deno.serve((req) =>
  handle(req, async (request) => {
    const body = await request.json().catch(() => ({}));
    const deviceId = requireUuid(body.device_id, "Device");
    const deviceName = cleanName(body.device_name);
    const admin = adminClient();
    const email = `device+${deviceId}@${DEVICE_EMAIL_DOMAIN}`;

    const { data: existing } = await admin.from("devices").select("auth_user_id, name").eq("id", deviceId).maybeSingle();
    if (!existing) {
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { device_id: deviceId, device_name: deviceName },
      });
    } else if (existing.name !== deviceName) {
      await admin.from("devices").update({ name: deviceName }).eq("id", deviceId);
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash || !link.user) {
      throw new HttpError(linkError?.message || "Could not start a session.");
    }
    if (!existing) {
      const { error: insertError } = await admin.from("devices").upsert({
        id: deviceId,
        auth_user_id: link.user.id,
        name: deviceName,
      });
      if (insertError) throw new HttpError(insertError.message);
    }

    const { data: verified, error: verifyError } = await admin.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    const session = verified?.session;
    if (verifyError || !session) throw new HttpError(verifyError?.message || "Could not start a session.");

    return json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user_id: session.user.id,
    });
  }),
);

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) return "This computer";
  return name;
}
