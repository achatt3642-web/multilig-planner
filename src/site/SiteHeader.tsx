import { useEffect, useRef, useState } from "react";
import { publicAssetPath } from "../publicAssetPath";

export type SiteSection = "surgery" | "demo";

export function SiteHeader({ active }: { active: SiteSection }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <header className="site-global-header">
      <div className="site-header-inner">
        <a className="site-brand-link" href="./" aria-label="Multilig Planner home">
          <img src={publicAssetPath("multilig-planner-logo.png")} alt="" aria-hidden="true" />
          <span>Multilig Planner</span>
        </a>

        <button
          ref={menuButtonRef}
          className="site-menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="site-primary-navigation"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav
          id="site-primary-navigation"
          className={`site-primary-navigation${menuOpen ? " open" : ""}`}
          aria-label="Primary navigation"
        >
          <a
            className={active === "surgery" ? "active" : undefined}
            href="./"
            aria-current={active === "surgery" ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          >
            Multiligament Knee Surgery
          </a>
          <a
            className={active === "demo" ? "active" : undefined}
            href="./demo.html"
            aria-current={active === "demo" ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          >
            Demo
          </a>
        </nav>
      </div>
    </header>
  );
}
