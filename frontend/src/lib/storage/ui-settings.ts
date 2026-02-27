import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";

// ============================================================================
// Debug Mode
// ============================================================================

export async function getDebugMode(): Promise<boolean> {
    return storage.getValueOrDefault<boolean>(STORAGE_KEYS.DEBUG_MODE, false);
}

export async function setDebugMode(enabled: boolean): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.DEBUG_MODE]: enabled,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

// ============================================================================
// Theme (Light/Dark Mode)
// ============================================================================

export type Theme = "light" | "dark" | "system";

export async function getTheme(): Promise<Theme> {
    return storage.getValueOrDefault<Theme>(STORAGE_KEYS.THEME, "system");
}

export async function setTheme(theme: Theme): Promise<void> {
    // Theme is a local UI preference, NOT included in the sync settings bundle.
    // Do NOT bump SETTINGS_LAST_MODIFIED here — it would make local settings appear
    // "newer" than remote, preventing legitimate remote changes from being pulled.
    await storage.set({ [STORAGE_KEYS.THEME]: theme });
    applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
    const root = document.documentElement;
    let isDark: boolean;
    if (theme === "system") {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } else {
        isDark = theme === "dark";
    }
    root.classList.toggle("dark", isDark);

    // Update the status bar color for PWA (Android/iOS)
    const themeColor = isDark ? "#020817" : "#ffffff";
    const meta = typeof document?.querySelector === "function"
        ? document.querySelector('meta[name="theme-color"]')
        : null;
    if (meta) {
        meta.setAttribute("content", themeColor);
    }
}

/**
 * Watch for OS theme changes and re-apply when theme is "system".
 * Returns a cleanup function to remove the listener.
 */
export function watchSystemTheme(): () => void {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = async () => {
        const theme = await getTheme();
        if (theme === "system") applyTheme(theme);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
}

