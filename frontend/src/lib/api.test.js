import { describe, expect, it } from "vitest";

import { parseApiError, parseResponseBody, parseSseEvent } from "./api";

describe("api helpers", () => {
  it("parses JSON errors before using a fallback message", () => {
    expect(parseApiError(400, { detail: "Bad request." }, "Fallback")).toBe("Bad request.");
    expect(parseApiError(500, { message: "Server exploded." }, "Fallback")).toBe("Server exploded.");
  });

  it("parses JSON and text response bodies", async () => {
    const jsonResponse = {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ ok: true }),
      text: async () => "",
      status: 200,
    };
    const textResponse = {
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => ({}),
      text: async () => "Request failed.",
      status: 500,
    };

    await expect(parseResponseBody(jsonResponse)).resolves.toEqual({ ok: true });
    await expect(parseResponseBody(textResponse)).resolves.toEqual({ detail: "Request failed." });
  });

  it("parses SSE payload blocks and ignores empty blocks", () => {
    expect(parseSseEvent("event: ping")).toBeNull();
    expect(parseSseEvent('data: {"delta":"hello"}')).toEqual({ delta: "hello" });
    expect(parseSseEvent('data: {"delta":"hello\\nworld"}')).toEqual({ delta: "hello\nworld" });
  });
});
