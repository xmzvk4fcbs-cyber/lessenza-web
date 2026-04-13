// Simple bot trap: if the hidden field in the payload is non-empty, it's a bot.

export function isHoneypotTriggered(body: unknown, field = "website"): boolean {
  if (!body || typeof body !== "object") return false;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim().length > 0;
}
