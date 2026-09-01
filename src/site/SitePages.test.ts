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
    expect(markup).toContain("How common is it?");
    expect(markup).toContain("Why might surgery be performed?");
    expect(markup).toContain("Challenges in surgical planning");
    expect(markup).toContain("How Multilig Planner may help");
    expect(markup).toContain("approximately 10,000 MLKIs occur annually");
    expect(markup).toContain("an estimated 4,000 patients undergoing multiligament repair");
    expect(markup).toContain("Some knees remain unstable after injury.");
    expect(markup).toContain("The broad goals are to restore stability and motion");
    expect(markup).toContain("Application will be available for download soon.");
    expect(markup.match(/available for download soon/gi)).toHaveLength(1);
    expect(markup).not.toMatch(/public download|download package|download \.zip|href="[^"]*download/i);
    expect(markup).not.toContain("Goals of surgery");
    expect(markup).not.toContain("Goals of care");
    expect(markup).not.toContain("not every multiligament injury is caused by one");
    expect(markup).not.toContain("not validated for clinical care");
    expect(markup).not.toContain("does not decide which operation should be performed");
    expect(markup).not.toContain("site-footer");
  });

  it("uses a restrained article layout with one small header logo", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage));

    expect(markup.match(/<img[^>]+src="[^"]*multilig-planner-logo\.png"/g)).toHaveLength(1);
    expect(markup.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(markup).toContain('href="#main-content"');
    expect(markup).toContain('id="main-content"');
    expect(markup).not.toContain("site-hero-visual");
    expect(markup).not.toContain("site-goal-grid");
    expect(markup).not.toContain("site-context-note");
    expect(markup).not.toContain("site-reference-list");
    expect(markup).not.toContain("<sup>");
    expect(markup).not.toContain("#reference-");
  });

  it("keeps the informational and demo pages as separate Vite entries", async () => {
    const root = resolve(import.meta.dirname, "../..");
    const [siteHtml, demoHtml] = await Promise.all([
      readFile(resolve(root, "index.html"), "utf8"),
      readFile(resolve(root, "demo.html"), "utf8"),
    ]);

    expect(siteHtml).toContain('src="/src/landing.tsx"');
    expect(demoHtml).toContain('src="/src/main.tsx"');
    expect(siteHtml).toContain("https://multilig-planner.org/og-v2.png");
    expect(demoHtml).toContain("https://multilig-planner.org/og-v2.png");
    expect(siteHtml).not.toContain("Clinician-directed 3D planning");
    expect(demoHtml).not.toContain("Clinician-directed 3D planning");
  });
});
