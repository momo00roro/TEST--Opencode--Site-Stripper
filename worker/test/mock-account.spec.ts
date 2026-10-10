import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script = await readFile(new URL("../../web/mock-account.js", import.meta.url), "utf8");

function loadMockAccount() {
  const handlers = new Map<string, (event: { preventDefault(): void }) => void>();
  const elements = new Map<string, { textContent: string; value: string }>();
  const inputs = ["full-name", "signup-email", "company", "signup-password", "confirm-password", "signin-email", "signin-password"]
    .map((id) => ({ id, value: "" }));
  const forms = new Map([
    ["signup-form", {
      addEventListener: (_type: string, handler: (event: { preventDefault(): void }) => void) => handlers.set("signup-form", handler),
      querySelectorAll: () => inputs.filter((input) => ["full-name", "signup-email", "company", "signup-password", "confirm-password"].includes(input.id)),
      reset: () => inputs.forEach((input) => { input.value = ""; }),
    }],
    ["signin-form", {
      addEventListener: (_type: string, handler: (event: { preventDefault(): void }) => void) => handlers.set("signin-form", handler),
      querySelectorAll: () => inputs.filter((input) => ["signin-email", "signin-password"].includes(input.id)),
      reset: () => inputs.forEach((input) => { input.value = ""; }),
    }],
  ]);
  const navigations: string[] = [];
  const window = { location: { assign: (path: string) => navigations.push(path) } };
  const document = {
    getElementById: (id: string) => {
      if (forms.has(id)) return forms.get(id);
      if (!elements.has(id)) elements.set(id, { textContent: "", value: "" });
      return elements.get(id);
    },
  };
  vm.runInNewContext(script, { document, window });
  return { handlers, inputs, navigations, elements, window };
}

describe("browser-only account mockups", () => {
  it("validates sign-up fields without accepting mismatched passwords", () => {
    const { window } = loadMockAccount() as ReturnType<typeof loadMockAccount> & {
      window: { SiteStripperMockAccount: { validateSignUp: (values: Record<string, string>) => string } };
    };
    const validate = window.SiteStripperMockAccount.validateSignUp;
    expect(validate({ "full-name": "Jane Smith", "signup-email": "jane@example.com", "signup-password": "long-enough", "confirm-password": "different" })).toMatch(/match/i);
    expect(validate({ "full-name": "Jane Smith", "signup-email": "jane@example.com", "signup-password": "long-enough", "confirm-password": "long-enough" })).toBe("");
  });

  it("validates sign-in fields and rejects malformed email", () => {
    const { window } = loadMockAccount() as ReturnType<typeof loadMockAccount> & {
      window: { SiteStripperMockAccount: { validateSignIn: (values: Record<string, string>) => string } };
    };
    const validate = window.SiteStripperMockAccount.validateSignIn;
    expect(validate({ "signin-email": "not-an-email", "signin-password": "password" })).toMatch(/email/i);
    expect(validate({ "signin-email": "jane@example.com", "signin-password": "password" })).toBe("");
  });

  it("routes valid submissions to generic completion pages and clears all entered values", () => {
    const { handlers, inputs, navigations } = loadMockAccount();
    inputs.find((input) => input.id === "full-name")!.value = "Jane Smith";
    inputs.find((input) => input.id === "signup-email")!.value = "jane@example.com";
    inputs.find((input) => input.id === "signup-password")!.value = "long-enough";
    inputs.find((input) => input.id === "confirm-password")!.value = "long-enough";
    let prevented = false;
    handlers.get("signup-form")!({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(navigations).toEqual(["./complete/index.html"]);
    expect(inputs.every((input) => input.value === "")).toBe(true);
  });

  it("keeps invalid submissions on the form and reports a field-level message", () => {
    const { handlers, navigations, elements } = loadMockAccount();
    let prevented = false;
    handlers.get("signin-form")!({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(navigations).toEqual([]);
    expect(elements.get("signin-error")?.textContent).toMatch(/email/i);
  });

  it("routes a valid sign-in without carrying input to the completion page", () => {
    const { handlers, inputs, navigations } = loadMockAccount();
    inputs.find((input) => input.id === "signin-email")!.value = "jane@example.com";
    inputs.find((input) => input.id === "signin-password")!.value = "anything";
    handlers.get("signin-form")!({ preventDefault() {} });
    expect(navigations).toEqual(["./complete/index.html"]);
    expect(inputs.find((input) => input.id === "signin-email")?.value).toBe("");
    expect(inputs.find((input) => input.id === "signin-password")?.value).toBe("");
  });

  it("does not send requests, persist input, or expose values in the destination", async () => {
    expect(script).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|sendBeacon/i);
    for (const pagePath of ["sign-up/index.html", "sign-in/index.html"]) {
      const html = await readFile(new URL(`../../web/${pagePath}`, import.meta.url), "utf8");
      expect(html).toContain("../mock-account.js");
      expect(html).not.toMatch(/<input[^>]+\bname=/i);
    }
  });
});
