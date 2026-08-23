import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LandingPage from "./LandingPage";
import { SiteHeader } from "./SiteHeader";

describe("public site pages", () => {
  it("provides exactly two global navigation destinations", () => {
    const markup = renderToStaticMarkup(createElement(SiteHeader, { active: "surgery" }));
    const navigation = markup.match(/<nav[^>]*aria-label="Primary navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    expect(navigation).toBeDefined();
    expect(Array.from(navigation!.matchAll(/href="([^"]+)"/g), (match) => match[1]))
      .toEqual(["./", "./demo.html"]);
    expect(navigation).toContain("Multiligament Knee Surgery");
    expect(navigation).toContain("Demo");
  });

  it("covers the requested educational topics without offering a download", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage));

    expect(markup).toContain("What is a multiligament knee injury?");
    expect(markup).toContain("Why surgery is performed");
    expect(markup).toContain("Goals of surgery");
    expect(markup).toContain("Surgical challenges");
    expect(markup).toContain("The unmet need");
    expect(markup).toContain("Application will be available for download soon.");
    expect(markup.match(/available for download soon/gi)).toHaveLength(1);
    expect(markup).not.toMatch(/public download|download package|download \.zip|href="[^"]*download/i);
    expect(markup).toContain("not validated for clinical care");
    expect(markup).toContain("does not decide which operation should be performed");
  });

  it("keeps the informational and demo pages as separate Vite entries", async () => {
    const root = resolve(import.meta.dirname, "../..");
    const [siteHtml, demoHtml] = await Promise.all([
      readFile(resolve(root, "index.html"), "utf8"),
      readFile(resolve(root, "demo.html"), "utf8"),
    ]);

    expect(siteHtml).toContain('src="/src/landing.tsx"');
    expect(demoHtml).toContain('src="/src/main.tsx"');
    expect(siteHtml).toContain("https://multilig-planner.org/og.png");
    expect(demoHtml).toContain("https://multilig-planner.org/og.png");
  });
});
