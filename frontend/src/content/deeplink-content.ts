/**
 * Deep Link Content Script
 * Intercepts clicks on links with promptId/agentMsg params
 * and opens the side panel instead of navigating.
 *
 * Configure the domain via VITE_DEEPLINK_DOMAIN in .env
 */

console.log("[Procura Deep Link] Content script loaded on:", window.location.href);

const DEEPLINK_DOMAIN = import.meta.env.VITE_DEEPLINK_DOMAIN || "";

function isDeepLinkUrl(href: string): boolean {
    if (!DEEPLINK_DOMAIN) return false;
    return href.includes(DEEPLINK_DOMAIN);
}

function handleProcuraLink(e: Event, link: HTMLAnchorElement): boolean {
    try {
        const url = new URL(link.href);
        // Only intercept if deep link params are present
        if (!url.searchParams.has("promptId") && !url.searchParams.has("agentMsg")) {
            return false;
        }

        // Stop all propagation and prevent navigation
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const promptId = url.searchParams.get("promptId");
        const agentMsg = url.searchParams.get("agentMsg");

        console.log("[Procura Deep Link] Intercepted:", { promptId, agentMsg });

        chrome.runtime.sendMessage({
            action: "openDeepLink",
            promptId,
            agentMsg
        });

        return true;
    } catch (err) {
        console.error("[Procura Deep Link] Failed to parse URL:", err);
        return false;
    }
}

// Intercept clicks on deep links (capture phase)
document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a");

    if (!link?.href || !isDeepLinkUrl(link.href)) return;

    handleProcuraLink(e, link);
}, true);

// Also intercept mousedown to catch some SPA frameworks
document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a");

    if (!link?.href || !isDeepLinkUrl(link.href)) return;

    // Check if it's a deep link and mark for interception
    try {
        const url = new URL(link.href);
        if (url.searchParams.has("promptId") || url.searchParams.has("agentMsg")) {
            console.log("[Procura Deep Link] Marking for interception on mousedown");
        }
    } catch {
        // ignore
    }
}, true);

// Intercept auxclick (middle-click) which opens links in new tabs
document.addEventListener("auxclick", (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a");

    if (!link?.href || !isDeepLinkUrl(link.href)) return;

    handleProcuraLink(e, link);
}, true);
