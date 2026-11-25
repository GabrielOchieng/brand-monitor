"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "bm.theme";

// Runs in <head> before the first paint, so a light-theme user never sees a dark flash.
// Storage can be blocked (private windows); then the default dark theme stays.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

function current(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(current()), []);
  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // A preference only; without storage it lasts until the next page load.
    }
    setTheme(next);
  }, []);
  return { theme, toggle };
}
