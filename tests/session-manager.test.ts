import { describe, expect, it } from "vitest";
import { hasCnkiAuthCookies } from "../src/browser/session-manager.js";

describe("CNKI auth detection helpers", () => {
  it("does not treat anonymous homepage cookies as a logged-in session", () => {
    expect(
      hasCnkiAuthCookies([
        { domain: "login.cnki.net", name: "SID" },
        { domain: "www.cnki.net", name: "SID" }
      ])
    ).toBe(false);
  });

  it("detects saved CNKI login cookies", () => {
    expect(
      hasCnkiAuthCookies([
        { domain: ".cnki.net", name: "Ecp_LoginStuts" },
        { domain: ".cnki.net", name: "LID" }
      ])
    ).toBe(true);
  });

  it("does not treat SID-only CNKI cookies as a logged-in session", () => {
    expect(
      hasCnkiAuthCookies([
        { domain: "ad.cnki.net", name: "SID" },
        { domain: "login.cnki.net", name: "SID" },
        { domain: "www.cnki.net", name: "SID" }
      ])
    ).toBe(false);
  });
});
