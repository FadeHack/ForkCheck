export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "forkcheck:theme";

export function parseTheme(value: string | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Runs before first paint so a stored choice never flashes the other theme. Kept free of
 * imports: it is inlined into the page as a string.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
