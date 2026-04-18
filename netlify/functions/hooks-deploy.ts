import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed } from "../lib/http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import * as path from "node:path";

/**
 * GitHub push webhook receiver.
 *
 * Flow:
 *   1. GitHub sends POST with X-Hub-Signature-256 + JSON payload
 *   2. We verify HMAC-SHA256 using GITHUB_WEBHOOK_SECRET from env
 *   3. If it's a push to `main`, we shell out to deploy.sh
 *   4. deploy.sh handles: git pull, npm install, sudo systemctl restart lessenza
 *
 * The response returns immediately with 202 so GitHub doesn't time out;
 * the actual deploy runs detached. Logs go to /tmp/lessenza-deploy.log.
 */

const REPO_ROOT = path.resolve(process.cwd());
const DEPLOY_SCRIPT = path.join(REPO_ROOT, "deploy", "webhook-deploy.sh");

function verifySig(body: string, signature: string, secret: string): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const sig = signature.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed — refuse to run if no secret is configured.
    return json({ error: "not-configured", message: "Webhook not configured" }, 503);
  }

  const sig = (event.headers["x-hub-signature-256"] ?? event.headers["X-Hub-Signature-256"] ?? "").trim();
  const body = event.body ?? "";
  if (!verifySig(body, sig, secret)) {
    return json({ error: "bad-signature" }, 401);
  }

  // Only act on push events (ping is sent once on webhook creation to test).
  const ghEvent = (event.headers["x-github-event"] ?? event.headers["X-GitHub-Event"] ?? "").trim();
  if (ghEvent === "ping") {
    return json({ ok: true, pong: true });
  }
  if (ghEvent !== "push") {
    return json({ ok: true, skipped: `event=${ghEvent}` });
  }

  // Parse ref; only deploy on push to main.
  let parsed: { ref?: string; head_commit?: { id?: string; message?: string } };
  try {
    parsed = JSON.parse(body);
  } catch {
    return badRequest("bad-json", "invalid JSON body");
  }
  if (parsed.ref !== "refs/heads/main") {
    return json({ ok: true, skipped: `ref=${parsed.ref}` });
  }

  // Fire-and-forget deploy; don't hold the GitHub request open.
  const child = spawn("bash", [DEPLOY_SCRIPT], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return json({
    ok: true,
    deploying: true,
    commit: parsed.head_commit?.id?.slice(0, 7) ?? "unknown",
    message: parsed.head_commit?.message?.split("\n")[0] ?? "",
  }, 202);
};
