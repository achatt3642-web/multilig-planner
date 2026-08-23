import SimplifiedApp from "../SimplifiedApp";
import { SiteHeader } from "./SiteHeader";

export default function DemoPage() {
  return (
    <div className="site-demo-shell">
      <a className="site-skip-link site-demo-skip-link" href="#planner-workspace">Skip to planner</a>
      <SiteHeader active="demo" />
      <div className="site-demo-app">
        <div className="site-demo-desktop-note" role="note">
          The planning workspace is desktop-oriented. Scroll horizontally to reach all controls.
        </div>
        <SimplifiedApp />
      </div>
    </div>
  );
}
