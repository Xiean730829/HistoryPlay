import React from "react";
import { createRoot } from "react-dom/client";
import { MuseumShell } from "./presentation/MuseumShell";
import { EraEntrance } from "./presentation/EraEntrance";
import "./style.css";
import "./styles/tokens.css";
import "./styles/corridor.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("legacy") === "1" ? <MuseumShell /> : <EraEntrance />}
  </React.StrictMode>,
);
