import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const landing = await readFile(new URL("../../web/index.html", import.meta.url), "utf8");
const alpha = await readFile(new URL("../../web/alpha/index.html", import.meta.url), "utf8");
const analyzer = await readFile(new URL("../../web/app/index.html", import.meta.url), "utf8");

describe("Site Stripper alpha pages", () => {
  it("keeps product and local-app routes available", () => {
    expect(landing).toContain("<!-- LOCAL_LAUNCH_BUTTON -->");
    expect(landing).toContain('href="/app/"');
    expect(landing).toContain('href="/alpha/"');
    expect(alpha).toContain('href="/app/"');
    expect(analyzer).toContain('id="analyze-form"');
  });

  it("states that alpha access does not create an account or require payment", () => {
    expect(alpha).toContain("Alpha access");
    expect(alpha).toContain("No account or payment is required");
    expect(alpha).not.toMatch(/<form\b|<input\b|<textarea\b|<select\b/i);
    expect(alpha).not.toMatch(/payment succeeded|account created|you are signed in/i);
  });

  it("avoids unapproved prices and unsupported public claims", () => {
    for (const page of [landing, alpha]) {
      expect(page).not.toMatch(/\b(?:MVP|demo|experiment|presentation)\b/i);
      expect(page).not.toMatch(/github\.com/i);
    }
    expect(landing).toContain("Paid plans are being finalized");
    expect(landing).not.toMatch(/(?:S\$|US\$|\$)\s?\d|\bSGD\s?\d/i);
  });
});
