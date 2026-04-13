import { describe, it, expect } from "vitest";
import { parseServiceAccount } from "../../netlify/lib/calendar";

describe("calendar env parsing", () => {
  it("parseServiceAccount accepts base64 JSON", () => {
    const sa = { client_email: "x@y.iam.gserviceaccount.com", private_key: "k" };
    const b64 = Buffer.from(JSON.stringify(sa)).toString("base64");
    expect(parseServiceAccount(b64)).toEqual(sa);
  });

  it("parseServiceAccount rejects empty", () => {
    expect(() => parseServiceAccount("")).toThrow();
  });

  it("parseServiceAccount rejects garbage", () => {
    expect(() => parseServiceAccount("not-b64!@#")).toThrow();
  });
});
