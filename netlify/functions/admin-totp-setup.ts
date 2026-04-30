import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { generateTotpSecret, buildOtpauthUrl, getAuth, setAuth } from "../lib/auth";
import { getSettings } from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const auth = await getAuth();
  if (!auth) return json({ error: "not-initialized", message: "Admin not set up" }, 409);
  // Refuse to re-roll the secret while 2FA is already on — otherwise the
  // owner's authenticator would still hold the old secret and next login
  // would lock her out. Owner must explicitly disable, then re-setup.
  if (auth.totpEnabled) {
    return json(
      { error: "already-enabled", message: "2FA je već uključeno. Prvo isključi pa ponovo uključi." },
      409
    );
  }
  // Generate a fresh secret each time the owner clicks "Setup 2FA". Never
  // confirmed → still rotatable.
  const secret = generateTotpSecret();
  await setAuth({ totpSecret: secret });
  const settings = await getSettings();
  const label = settings.ownerEmail || "admin@lessenza.me";
  return json({
    secret,
    otpauthUrl: buildOtpauthUrl(secret, label),
  });
};

export const handler = adminGuard(inner);
