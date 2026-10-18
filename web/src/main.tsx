import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app.tsx";
import { initZoomBaseline } from "./hooks/use-zoom-guard.tsx";
import "./main.css";
import { initTheme } from "./scripts/theme-init.ts";

initTheme();
initZoomBaseline();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
