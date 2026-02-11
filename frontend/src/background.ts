// Background service worker for Procura extension

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        chrome.sidePanel.open({ tabId: tab.id });
    }
});

// Enable side panel for all URLs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle deep link messages from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === "openDeepLink" && sender.tab?.windowId) {
        console.log("[Background] Deep link received:", msg);

        // Store deep link data for side panel to read
        chrome.storage.local.set({
            pendingDeepLink: {
                promptId: msg.promptId,
                agentMsg: msg.agentMsg,
                timestamp: Date.now()
            }
        });

        // Open side panel on the current window
        chrome.sidePanel.open({ windowId: sender.tab.windowId });
    }
});
