import { describe, it, expect } from "vitest";
import { normalizePhone, formatPhoneNational, waLink, digitsOnly } from "../../netlify/lib/phone";

describe("phone", () => {
  it("normalizePhone accepts +382 69 123 456 and returns E.164", () => {
    expect(normalizePhone("+382 69 123 456")).toBe("+38269123456");
  });

  it("normalizePhone accepts local 069123456 with default country +382", () => {
    expect(normalizePhone("069123456", "+382")).toBe("+38269123456");
  });

  it("normalizePhone accepts 069 123 456 with spaces", () => {
    expect(normalizePhone("069 123 456", "+382")).toBe("+38269123456");
  });

  it("normalizePhone returns null for obvious junk", () => {
    expect(normalizePhone("abc", "+382")).toBeNull();
    expect(normalizePhone("12", "+382")).toBeNull();
    expect(normalizePhone("", "+382")).toBeNull();
  });

  it("formatPhoneNational returns a human-friendly form", () => {
    expect(formatPhoneNational("+38269123456")).toBe("069 123 456");
  });

  it("waLink builds wa.me URL with digits only and encoded text", () => {
    expect(waLink("+38269123456", "Zdravo, test")).toBe(
      "https://wa.me/38269123456?text=Zdravo%2C%20test"
    );
  });

  it("digitsOnly strips all non-digits", () => {
    expect(digitsOnly("+382 69-123/456")).toBe("38269123456");
  });
});
