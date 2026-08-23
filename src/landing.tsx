import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LandingPage from "./site/LandingPage";
import "./site/site.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
