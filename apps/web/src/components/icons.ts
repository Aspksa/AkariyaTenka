export type IconName = "home" | "activity" | "refresh" | "chevron-left" | "chevron-right" | "bell" | "settings" | "arrow-up" | "arrow-down" | "eye" | "eye-off" | "check" | "alert" | "info" | "arrow-right" | "shield" | "close";
const paths: Record<IconName, string[]> = {
  home: ["m3 10 9-7 9 7", "M5 9v12h14V9", "M9 21v-7h6v7"],
  activity: ["M22 12h-4l-3 9-6-18-3 9H2"],
  refresh: ["M20 7v5h-5", "M4 17v-5h5", "M5.6 9a7 7 0 0 1 12-2L20 12", "M4 12l2.4 5a7 7 0 0 0 12-2"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  settings: ["M12 3v2", "M12 19v2", "M3 12h2", "M19 12h2", "m5.6 5.6 1.4 1.4", "m17 17 1.4 1.4", "m18.4 5.6-1.4 1.4", "M7 17l-1.4 1.4", "M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0"],
  "arrow-up": ["m12 19 0-14", "m5 12 7-7 7 7"],
  "arrow-down": ["m12 5 0 14", "m19 12-7 7-7-7"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"],
  "eye-off": ["m3 3 18 18", "M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a16 16 0 0 1-3.4 3.8", "M6.2 6.2C3.6 8.1 2 12 2 12s4 7 10 7a9.8 9.8 0 0 0 4.1-.9"],
  check: ["m5 12 4 4L19 6"],
  alert: ["M12 3 2 21h20L12 3Z", "M12 9v5", "M12 18h.01"],
  "arrow-right": ["M5 12h14", "m13 6 6 6-6 6"],
  shield: ["M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z", "m9 12 2 2 4-4"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M12 11v6", "M12 7h.01"]
};
const ns = "http://www.w3.org/2000/svg";
export function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox","0 0 24 24");
  svg.setAttribute("fill","none");
  svg.setAttribute("stroke","currentColor");
  svg.setAttribute("stroke-width","1.8");
  svg.setAttribute("stroke-linecap","round");
  svg.setAttribute("stroke-linejoin","round");
  svg.setAttribute("aria-hidden","true");
  svg.classList.add("ui-icon");
  for (const d of paths[name]) {
    const path = document.createElementNS(ns,"path");
    path.setAttribute("d",d);
    svg.append(path);
  }
  return svg;
}
