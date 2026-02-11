import { storage } from "./adapter";

// ============================================================================
// Debug: Storage Usage Analysis
// ============================================================================

export interface StorageUsageItem {
    key: string;
    sizeBytes: number;
    sizeFormatted: string;
}

export interface StorageUsageReport {
    items: StorageUsageItem[];
    totalBytes: number;
    totalFormatted: string;
    quotaBytes: number;
    quotaFormatted: string;
    usagePercent: number;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function debugStorageUsage(): Promise<StorageUsageReport> {
    const allData = await storage.get(null);
    const items: StorageUsageItem[] = [];

    for (const [key, value] of Object.entries(allData)) {
        const json = JSON.stringify(value);
        const sizeBytes = new Blob([json]).size;
        items.push({
            key,
            sizeBytes,
            sizeFormatted: formatBytes(sizeBytes),
        });
    }

    // Sort by size descending
    items.sort((a, b) => b.sizeBytes - a.sizeBytes);

    const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    const quotaBytes = 10 * 1024 * 1024; // 10MB limit for chrome.storage.local

    const report: StorageUsageReport = {
        items,
        totalBytes,
        totalFormatted: formatBytes(totalBytes),
        quotaBytes,
        quotaFormatted: formatBytes(quotaBytes),
        usagePercent: (totalBytes / quotaBytes) * 100,
    };

    // Log to console
    console.group("📊 Chrome Storage Usage Report");
    console.log(`Total: ${report.totalFormatted} / ${report.quotaFormatted} (${report.usagePercent.toFixed(1)}%)`);
    console.log("");
    console.log("By Key (sorted by size):");
    for (const item of items) {
        const bar = "█".repeat(Math.ceil((item.sizeBytes / totalBytes) * 20));
        console.log(`  ${item.key}: ${item.sizeFormatted} ${bar}`);
    }
    console.groupEnd();

    return report;
}

// Make it available globally for console debugging
if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).debugStorageUsage = debugStorageUsage;
}
