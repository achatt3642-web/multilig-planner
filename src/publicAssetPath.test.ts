import { describe, expect, it } from "vitest";
import { publicAssetPath } from "./publicAssetPath";

describe("public asset path", () => {
  it("resolves assets at the local origin root", () => {
    expect(publicAssetPath("mat-viewer-v2.html", "/")).toBe("/mat-viewer-v2.html");
  });

  it("preserves a GitHub Pages project base without a double slash", () => {
    expect(publicAssetPath("/multilig-planner-logo.png", "/multilig-planner-site/"))
      .toBe("/multilig-planner-site/multilig-planner-logo.png");
  });

  it("supports the relative base used by the production Pages artifact", () => {
    expect(publicAssetPath("vendor/three/three.module.js", "./"))
      .toBe("./vendor/three/three.module.js");
  });
});
