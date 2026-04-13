import { describe, it, expect } from "vitest";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../../netlify/lib/http";

describe("http helpers", () => {
  it("json() returns 200 with JSON body and content-type", () => {
    const r = json({ a: 1 });
    expect(r.statusCode).toBe(200);
    expect(r.headers?.["content-type"]).toBe("application/json");
    expect(r.body).toBe('{"a":1}');
  });

  it("json() accepts custom status", () => {
    expect(json({ ok: true }, 201).statusCode).toBe(201);
  });

  it("badRequest returns 400 with error code", () => {
    const r = badRequest("invalid-foo", "Foo is wrong");
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body as string)).toEqual({ error: "invalid-foo", message: "Foo is wrong" });
  });

  it("unauthorized returns 401", () => {
    expect(unauthorized().statusCode).toBe(401);
  });

  it("methodNotAllowed returns 405 with Allow header", () => {
    const r = methodNotAllowed(["GET", "POST"]);
    expect(r.statusCode).toBe(405);
    expect(r.headers?.["allow"]).toBe("GET, POST");
  });

  it("parseJson returns parsed body or throws", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJson("nope")).toThrow();
    expect(() => parseJson(null)).toThrow();
  });
});
