"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "theme";
const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];

// Runs in <head> before paint so a saved light/dark choice doesn't flash the system theme first.
export const THEME_INIT_SCRIPT = `try{const t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch{}`;

const applyTheme = (theme: Theme) => {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.removeItem(THEME_KEY);
  } else {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }
};

export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = document.documentElement.getAttribute("data-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    }
  }, []);

  return (
    <fieldset className="flex overflow-hidden rounded-full border border-line-strong font-semibold">
      <legend className="sr-only">Theme</legend>
      {THEMES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          className={`px-2.5 py-1 capitalize ${theme === value ? "bg-primary text-on-primary" : "text-ink-muted"}`}
          onClick={() => {
            applyTheme(value);
            setTheme(value);
          }}
        >
          {value}
        </button>
      ))}
    </fieldset>
  );
};
