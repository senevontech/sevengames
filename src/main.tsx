import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initNative } from "./lib/native";
import { splashStep, splashWhenPageReady } from "./lib/splash";
import "./styles.css";
import "./ui.css";
import "./orbit.css";
import "./app-perf.css";
import "./lite.css";
// clay buttons, site-wide (after everything: see the file)
import "./clay.css";
import { initPerf } from "./lib/perf";

initPerf(); // lite mode on low-end phones (before the first paint)
void initNative();
// the app code has arrived: the splash moves on, then finishes once the first page is drawn
splashStep(50);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

requestAnimationFrame(() => {
  splashStep(70);
  splashWhenPageReady();
});
