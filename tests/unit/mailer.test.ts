import { describe, it, expect } from "vitest";
import { createLogMailer, type EmailMessage } from "../../netlify/lib/mailer";

describe("log mailer", () => {
  it("records sent messages", async () => {
    const m = createLogMailer();
    const msg: EmailMessage = {
      to: "x@example.com",
      subject: "Hello",
      text: "Body",
    };
    await m.send(msg);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject(msg);
  });

  it("returns id", async () => {
    const m = createLogMailer();
    const id = await m.send({ to: "x@x.com", subject: "s", text: "t" });
    expect(typeof id).toBe("string");
  });
});
