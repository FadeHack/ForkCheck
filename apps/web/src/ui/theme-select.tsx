"use client";

import { useSyncExternalStore, type ChangeEvent } from "react";
import { parseTheme, THEME_KEY, type ThemeChoice } from "./theme-script";

const CHANGE = "forkcheck:theme-change";

function stored(): ThemeChoice {
  try {
    return parseTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return parseTheme(document.documentElement.dataset.theme ?? null);
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** "Match system" removes the attribute, so the stylesheet's media query decides. */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement) {
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/**
 * A native select rather than a toggle button: three states (system, light, dark) fit one
 * control that keyboards and screen readers already know, and it stays small on a phone.
 */
export function ThemeSelect() {
  const choice = useSyncExternalStore(subscribe, stored, () => "system" as const);

  function change(event: ChangeEvent<HTMLSelectElement>) {
    const next = parseTheme(event.target.value);
    applyTheme(next);
    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be blocked; the choice still holds for this page.
    }
    window.dispatchEvent(new Event(CHANGE));
  }

  return (
    <label className="theme-select">
      Theme
      <select value={choice} onChange={change}>
        <option value="system">Match system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
