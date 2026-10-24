import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        alt?: string;
        "camera-controls"?: boolean | "";
        "camera-orbit"?: string;
        "interaction-prompt"?: "auto" | "none";
        src?: string;
        "shadow-intensity"?: string;
        "touch-action"?: "pan-y" | "pan-x" | "none";
      };
    }
  }
}
