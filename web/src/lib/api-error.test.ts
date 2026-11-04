import { describe, expect, it } from "vitest";

import { isSameOrigin } from "./api-error";

describe("isSameOrigin", () => {
  it("uses the browser-facing Host when the framework URL is internal", () => {
    const request = new Request("http://internal/api/documents", {
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });

    expect(isSameOrigin(request)).toBe(true);
  });

  it("rejects a mismatched origin and host", () => {
    const request = new Request("http://127.0.0.1:3000/api/documents", {
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://attacker.example",
      },
    });

    expect(isSameOrigin(request)).toBe(false);
  });

  it("allows requests without an Origin header", () => {
    const request = new Request("http://127.0.0.1:3000/api/documents");

    expect(isSameOrigin(request)).toBe(true);
  });
});
