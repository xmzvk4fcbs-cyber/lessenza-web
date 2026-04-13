import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createResendMailer, createGmailMailer, createLogMailer } from "../../netlify/lib/mailer";

describe("resend mailer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Resend API with expected payload and returns id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-1" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const m = createResendMailer({ apiKey: "key-abc", from: "L'Essenza <from@example.com>" });
    const id = await m.send({ to: "x@y.com", subject: "hi", text: "body" });
    expect(id).toBe("resend-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer key-abc");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: "x@y.com", from: "L'Essenza <from@example.com>", subject: "hi", text: "body" });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad" }));
    const m = createResendMailer({ apiKey: "k", from: "a@b.com" });
    await expect(m.send({ to: "x@y.com", subject: "s", text: "t" })).rejects.toThrow(/resend/i);
  });
});

describe("gmail mailer", () => {
  it("sends via provided transport and returns messageId", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<gmail-1>" });
    const m = createGmailMailer({
      user: "owner@gmail.com",
      pass: "app-pw",
      transportFactory: () => ({ sendMail } as never),
    });
    const id = await m.send({ to: "x@y.com", subject: "hi", text: "body" });
    expect(id).toBe("<gmail-1>");
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: "x@y.com",
      from: "owner@gmail.com",
      subject: "hi",
      text: "body",
    });
  });
});

describe("log mailer still works", () => {
  it("records messages", async () => {
    const m = createLogMailer();
    await m.send({ to: "x", subject: "s", text: "t" });
    expect(m.sent).toHaveLength(1);
  });
});
