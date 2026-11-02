"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
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

function choose(next: ThemeChoice) {
  applyTheme(next);
  try {
    if (next === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage can be blocked; the choice still holds for this page.
  }
  window.dispatchEvent(new Event(CHANGE));
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "Match system",
};

const ORDER: ThemeChoice[] = ["light", "dark", "system"];

/** Drawn to match the fork mark's stroke: a sun, a moon, and a half-filled circle for "system". */
function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {choice === "light" && (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
        </>
      )}
      {choice === "dark" && <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />}
      {choice === "system" && (
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" className="theme-icon-fill" />
        </>
      )}
    </svg>
  );
}

/**
 * One round button that opens the three choices. A disclosure with pressed buttons rather than
 * an ARIA menu: Tab and Enter work as everywhere else, and Escape or a click outside closes it.
 */
export function ThemeSelect() {
  const choice = useSyncExternalStore(subscribe, stored, () => "system" as const);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
    function outside(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function key(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div
      className="theme-select"
      ref={root}
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="theme-toggle"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Theme: ${THEME_LABELS[choice]}`}
        onClick={() => setOpen((o) => !o)}
      >
        <ThemeIcon choice={choice} />
      </button>
      <ul id={listId} className="theme-options" hidden={!open} aria-label="Theme">
        {ORDER.map((c) => (
          <li key={c}>
            <button
              type="button"
              aria-pressed={c === choice}
              onClick={() => {
                choose(c);
                setOpen(false);
                toggle.current?.focus();
              }}
            >
              {THEME_LABELS[c]}
              {c === choice && (
                <span className="pencil-tick" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
