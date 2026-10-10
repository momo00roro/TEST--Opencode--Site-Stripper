import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const page = async (relativePath: string) =>
  readFile(new URL(`../../web/${relativePath}`, import.meta.url), "utf8");
const landingStyles = await readFile(new URL("../../web/landing.css", import.meta.url), "utf8");

describe("Site Stripper public pages", () => {
  it("includes every linked marketing and account route", async () => {
    const [home, features, howItWorks, samplePack, faq, signUp, signIn, signUpComplete, signInComplete] = await Promise.all([
      page("index.html"),
      page("features/index.html"),
      page("how-it-works/index.html"),
      page("sample-pack/index.html"),
      page("faq/index.html"),
      page("sign-up/index.html"),
      page("sign-in/index.html"),
      page("sign-up/complete/index.html"),
      page("sign-in/complete/index.html"),
    ]);
    for (const html of [home, features, howItWorks, samplePack, faq, signUp, signIn, signUpComplete, signInComplete]) {
      expect(html).toContain("© 2026 Site Stripper. Made with ❤️ by CHEEE.WORK");
      expect(html).not.toMatch(/a CHEEE web tool|alpha access|paid plans are being finalized/i);
      expect(html).not.toMatch(/no account or payment details needed|alpha access does not require payment/i);
      expect(html).not.toContain("/app/");
      expect(html).not.toMatch(/github\.com/i);
    }
    expect(home).toContain('href="./features/index.html"');
    expect(home).toContain('href="./how-it-works/index.html"');
    expect(home).toContain('href="./sample-pack/index.html"');
    expect(home).toContain('href="./faq/index.html"');
    expect(home).toContain('href="./sign-up/index.html"');
    expect(home).toContain('href="./sign-in/index.html"');
  });

  it("keeps product claims tied to the hosted analyzer behavior", async () => {
    const pages = await Promise.all([
      page("index.html"),
      page("features/index.html"),
      page("how-it-works/index.html"),
      page("faq/index.html"),
    ]);
    const copy = pages.join("\n").toLowerCase();
    expect(copy).toContain("10 pages");
    expect(copy).toContain("150 seconds");
    expect(copy).toContain("when captured");
    expect(copy).not.toMatch(/AI-powered|guaranteed screenshots|CAPTCHA bypass/i);
  });

  it("renders the sample tree and content from its verified package manifest", async () => {
    const sampleHtml = await page("sample-pack/index.html");
    const manifest = JSON.parse(await page("sample-pack/files.json"));
    const preview = JSON.parse(await page("sample-pack/preview.json"));
    for (const file of manifest.files) expect(sampleHtml).toContain(file.path);
    for (const file of preview.files) {
      expect(sampleHtml).toContain(file.path);
      expect(sampleHtml).toContain(file.content[0]);
    }
    expect(sampleHtml).toContain("./assets/example-home.webp");
    expect(sampleHtml.toLowerCase()).toContain("when captured");
  });

  it("uses the approved purple, lavender, gray, and yellow palette", () => {
    expect(landingStyles).toContain("--purple:");
    expect(landingStyles).toContain("--lavender:");
    expect(landingStyles).toContain("--yellow:");
    expect(landingStyles).not.toMatch(/--(?:orange|blue|mint):/);
  });
});
