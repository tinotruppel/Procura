/**
 * Screenshot Content Script
 * This script is injected into pages to capture screenshots using bundled html2canvas.
 * It runs in the ISOLATED world to avoid CSP issues.
 */
import html2canvas from "html2canvas";

// Listen for screenshot requests from the extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "CAPTURE_SCREENSHOT") {
        const fullPage = message.fullPage || false;
        captureScreenshot(fullPage)
            .then(sendResponse)
            .catch((error) => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Screenshot failed",
                });
            });
        return true; // Keep channel open for async response
    }
});

async function captureScreenshot(fullPage: boolean) {
    // Configure capture dimensions based on mode
    const options = fullPage
        ? {
            // Full page: capture entire document
            useCORS: true,
            allowTaint: true,
            scrollX: 0,
            scrollY: 0,
            windowWidth: document.documentElement.scrollWidth,
            windowHeight: document.documentElement.scrollHeight,
            logging: false,
        }
        : {
            // Viewport only: capture visible area
            useCORS: true,
            allowTaint: true,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            width: window.innerWidth,
            height: window.innerHeight,
            x: window.scrollX,
            y: window.scrollY,
            logging: false,
        };

    const canvas = await html2canvas(document.body, options);

    // Resize to max 1600px width for better text readability
    const maxWidth = 1600;
    let width = canvas.width;
    let height = canvas.height;

    if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = Math.round(height * ratio);
    }

    // Create resized canvas
    const resizedCanvas = document.createElement("canvas");
    resizedCanvas.width = width;
    resizedCanvas.height = height;
    const ctx = resizedCanvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");

    ctx.drawImage(canvas, 0, 0, width, height);

    // Convert to JPEG with 92% quality for better text clarity
    const dataUrl = resizedCanvas.toDataURL("image/jpeg", 0.92);

    return {
        success: true,
        dataUrl,
        width,
        height,
        originalWidth: canvas.width,
        originalHeight: canvas.height,
        fullPage,
    };
}

