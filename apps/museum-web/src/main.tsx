import React from "react";
import { createRoot } from "react-dom/client";
import { MuseumShell } from "./presentation/MuseumShell";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MuseumShell />
  </React.StrictMode>,
);
