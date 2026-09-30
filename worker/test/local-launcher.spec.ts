import { describe, expect, it } from "vitest";
import { LOCAL_CHROME_ARGS } from "../local/launcher";

describe("local Chrome launch flags", () => {
  it("allows scroll-triggered muted autoplay without a user gesture", () => {
    // Figma-style scroll-autoplay facades boot on IntersectionObserver in a
    // hand-driven browser; headless Chrome's default autoplay policy blocks
    // the same play() calls, so captures must opt out at launch.
    expect(LOCAL_CHROME_ARGS).toContain("--autoplay-policy=no-user-gesture-required");
  });

  it("keeps autoplay silent and preserves the sandbox baseline", () => {
    expect(LOCAL_CHROME_ARGS).toContain("--mute-audio");
    expect(LOCAL_CHROME_ARGS).toContain("--no-sandbox");
    expect(LOCAL_CHROME_ARGS).toContain("--disable-dev-shm-usage");
  });
});
