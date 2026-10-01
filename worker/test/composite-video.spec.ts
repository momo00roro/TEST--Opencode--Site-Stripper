import { describe, expect, it } from "vitest";
import { compositeSectionStills, coverRect, planComposites } from "../../web/composite-video.mjs";

const SECTION = { kind: "webp", bytes: 10, width: 1440, height: 800, y: 1000, dataUrl: "data:image/webp;base64,AAA=" };
const VIDEO = {
  kind: "webp",
  bytes: 10,
  width: 1440,
  height: 400,
  y: 1200,
  label: "video: Demo",
  dataUrl: "data:image/webp;base64,BBB=",
  placement: { x: 100, y: 1200, width: 600, height: 400 },
};

function pageWith(overrides = {}) {
  return {
    viewport: { width: 1440, height: 900 },
    sectionShots: [{ ...SECTION }],
    videoShots: [{ ...VIDEO }],
    ...overrides,
  };
}

describe("planComposites", () => {
  it("matches a placed frame to its section with section-relative dest", () => {
    const plans = planComposites(pageWith());

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      sectionIndex: 0,
      videoIndex: 0,
      dest: { x: 100, y: 200, w: 600, h: 400 },
    });
  });

  it("skips unplaced frames and binary-less shots rather than misattributing", () => {
    const page = pageWith({
      sectionShots: [{ ...SECTION }, { ...SECTION, y: 2000, dataUrl: null }],
      videoShots: [
        { ...VIDEO, placement: undefined },
        { ...VIDEO, dataUrl: null },
        { ...VIDEO, placement: { x: 0, y: 5000, width: 100, height: 100 } },
      ],
    });

    expect(planComposites(page)).toEqual([]);
  });

  it("collects several videos landing in one section", () => {
    const page = pageWith({
      videoShots: [
        { ...VIDEO, placement: { x: 0, y: 1100, width: 200, height: 200 } },
        { ...VIDEO, placement: { x: 300, y: 1500, width: 200, height: 200 } },
      ],
    });

    const plans = planComposites(page);
    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.videoIndex)).toEqual([0, 1]);
  });
});

describe("coverRect", () => {
  it("crops the sides of a wide frame into a narrow dest", () => {
    const crop = coverRect(1280, 720, { w: 400, h: 400 });
    expect(crop).toMatchObject({ sy: 0, sh: 720 });
    expect(crop?.sw).toBeCloseTo(720, 6);
    expect(crop?.sx).toBeCloseTo(280, 6);
  });

  it("crops top and bottom of a tall frame into a wide dest", () => {
    const crop = coverRect(720, 1280, { w: 800, h: 400 });
    expect(crop?.sy).toBeGreaterThan(0);
    expect(crop?.sw).toBeCloseTo(720, 6);
  });

  it("keeps the full frame when aspects already match", () => {
    expect(coverRect(1280, 720, { w: 1280, h: 720 })).toMatchObject({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it("rejects bad geometry", () => {
    expect(coverRect(0, 720, { w: 100, h: 100 })).toBeNull();
    expect(coverRect(1280, 720, { w: 0, h: 100 })).toBeNull();
  });
});

describe("compositeSectionStills", () => {
  function fakeDeps(sizes: Record<string, { width: number; height: number }>) {
    const canvases: Array<{ ops: unknown[][]; width: number; height: number }> = [];
    return {
      canvases,
      loadImage: async (dataUrl: string) => {
        const size = sizes[dataUrl];
        if (!size) throw new Error("missing fixture image");
        return { width: size.width, height: size.height };
      },
      createCanvas: (w: number, h: number) => {
        const canvas = {
          ops: [] as unknown[][],
          width: w,
          height: h,
          getContext: () => ({
            drawImage: (...args: unknown[]) => {
              canvas.ops.push(args);
            },
          }),
          toDataURL: () => "data:image/webp;base64,Q09NUE9TSVRFRA==",
        };
        canvases.push(canvas);
        return canvas;
      },
    };
  }

  it("is a no-op where canvas is unavailable and touches nothing", async () => {
    const analysis: { pages: any[] } = { pages: [pageWith()] };

    const stats = await compositeSectionStills(analysis);

    expect(stats.composited).toBe(0);
    expect(stats.unavailable).toBe(true);
    expect(analysis.pages[0].sectionShots[0].dataUrl).toBe("data:image/webp;base64,AAA=");
    expect("__composited" in analysis).toBe(false);
  });

  it("draws the cover-fit still and patches the section binary", async () => {
    const analysis: { pages: any[] } = { pages: [pageWith()] };
    const deps = fakeDeps({
      "data:image/webp;base64,AAA=": { width: 1440, height: 800 },
      "data:image/webp;base64,BBB=": { width: 1280, height: 720 },
    });

    const stats = await compositeSectionStills(analysis, deps);

    expect(stats.composited).toBe(1);
    const section = analysis.pages[0].sectionShots[0];
    expect(section.dataUrl).toBe("data:image/webp;base64,Q09NUE9TSVRFRA==");
    // "Q09NUE9TSVRFRA==" decodes to 10 bytes.
    expect(section.bytes).toBe(10);
    expect(section.kind).toBe("webp");
    expect(section.composited).toBe(true);
    // Base blit, then the cover-fit still at the section-relative dest.
    expect(deps.canvases).toHaveLength(1);
    expect(deps.canvases[0]?.ops).toHaveLength(2);
    const still = deps.canvases[0]?.ops[1] as number[];
    expect(still?.slice(5)).toEqual([100, 200, 600, 400]);
    expect(still?.[1]).toBeCloseTo(100, 6);
    expect(still?.[2]).toBeCloseTo(0, 6);
    // Idempotent per analysis object.
    const again = await compositeSectionStills(analysis, deps);
    expect(again.composited).toBe(0);
    expect(again.cached).toBe(true);
  });

  it("draws a fetched thumbnail from the thumbnail list and reports it", async () => {
    const thumb = {
      kind: "jpeg",
      bytes: 8,
      width: 1440,
      height: 400,
      y: 1200,
      label: "thumbnail: Grid 0",
      dataUrl: "data:image/jpeg;base64,VEhVTUI=",
      placement: { x: 100, y: 1200, width: 600, height: 400 },
    };
    const analysis: { pages: any[] } = {
      pages: [pageWith({ videoShots: [], videoThumbnails: [thumb] })],
    };
    const deps = fakeDeps({
      "data:image/webp;base64,AAA=": { width: 1440, height: 800 },
      "data:image/jpeg;base64,VEhVTUI=": { width: 640, height: 427 },
    });

    const stats = await compositeSectionStills(analysis, deps);

    expect(stats.composited).toBe(1);
    expect(stats.thumbnails).toBe(1);
    expect(analysis.pages[0].sectionShots[0].composited).toBe(true);
    expect(deps.canvases).toHaveLength(1);
    expect(deps.canvases[0]?.ops).toHaveLength(2);
  });

  it("skips sections whose pixels do not match page pixels", async () => {
    const analysis: { pages: any[] } = { pages: [pageWith()] };
    const deps = fakeDeps({
      "data:image/webp;base64,AAA=": { width: 720, height: 400 },
      "data:image/webp;base64,BBB=": { width: 1280, height: 720 },
    });

    const stats = await compositeSectionStills(analysis, deps);

    expect(stats.composited).toBe(0);
    expect(stats.skipped).toMatchObject([{ section: 0, video: 0, reason: "scale-mismatch" }]);
    expect(analysis.pages[0].sectionShots[0].dataUrl).toBe("data:image/webp;base64,AAA=");
  });
});

describe("CF25 fallback thumbnails", () => {
  const THUMB = {
    kind: "jpeg",
    bytes: 8,
    width: 1440,
    height: 400,
    y: 1200,
    label: "thumbnail: Grid 0",
    dataUrl: "data:image/jpeg;base64,VEhVTUI=",
    placement: { x: 100, y: 1200, width: 600, height: 400 },
  };

  it("plans fetched thumbnails exactly like placed frames, marked as fallback", () => {
    const page = pageWith({ videoShots: [], videoThumbnails: [{ ...THUMB }] });

    const plans = planComposites(page);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      sectionIndex: 0,
      videoIndex: 0,
      thumb: true,
      dest: { x: 100, y: 200, w: 600, h: 400 },
    });
  });

  it("draws fetched thumbnails alongside motion-verified plans", () => {
    const plans = planComposites(pageWith({ videoThumbnails: [{ ...THUMB }] }));

    expect(plans.map((plan) => plan.thumb)).toEqual([false, true]);
  });
});
