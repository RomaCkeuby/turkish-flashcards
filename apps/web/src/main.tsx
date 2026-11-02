import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { App } from "./App";
import "./styles.css";

const Router = import.meta.env.VITE_STATIC_SITE === "1" ? HashRouter : BrowserRouter;
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
