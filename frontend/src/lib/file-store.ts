/**
 * File Store
 * Stores files (images, documents, audio, etc.) with unique IDs for reference by LLM tools.
 * IDs are generated using a hash of the file data.
 */

// Stored file metadata
interface StoredFile {
    dataUrl: string;      // Full base64 data URL
    mimeType: string;     // e.g. "application/pdf", "image/png"
    fileName: string;     // Original filename
    fileSize: number;     // Size in bytes
}

// Global store: ID -> StoredFile
const fileStore = new Map<string, StoredFile>();

/**
 * Generate a short hash-like ID from a string.
 * Uses a simple hash function since crypto.subtle is async.
 */
function generateShortId(data: string, prefix: string = "file"): string {
    let hash = 0;
    for (let i = 0; i < Math.min(data.length, 10000); i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to hex and take 8 characters
    const hexHash = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
    return `${prefix}_${hexHash}`;
}

/**
 * Get MIME type from a data URL
 */
function getMimeTypeFromDataUrl(dataUrl: string): string {
    const match = /^data:([^;]+);/.exec(dataUrl);
    return match ? match[1] : "application/octet-stream";
}

/**
 * Estimate file size from base64 data URL
 */
function getFileSizeFromDataUrl(dataUrl: string): number {
    const base64Match = /;base64,(.+)$/.exec(dataUrl);
    if (!base64Match) return 0;
    // Base64 encodes 3 bytes as 4 characters
    const base64Data = base64Match[1];
    // Base64 padding is at most 2 '=' characters, use bounded quantifier to prevent ReDoS
    const padding = (/={1,2}$/.exec(base64Data) || [''])[0].length;
    return Math.floor((base64Data.length * 3) / 4) - padding;
}

/**
 * Add a file to the store.
 * @param dataUrl - Full data URL (e.g., "data:application/pdf;base64,...")
 * @param fileName - Original filename (e.g., "document.pdf")
 * @returns The unique file ID (e.g., "file_a3f8b2c1")
 */
export function addFile(dataUrl: string, fileName: string): string {
    const id = generateShortId(dataUrl, "file");
    const mimeType = getMimeTypeFromDataUrl(dataUrl);
    const fileSize = getFileSizeFromDataUrl(dataUrl);

    fileStore.set(id, {
        dataUrl,
        mimeType,
        fileName,
        fileSize,
    });

    console.log(`[FileStore] Added file: ${id} (${fileName}, ${mimeType}, ${Math.round(fileSize / 1024)}KB)`);
    return id;
}

/**
 * Get a file from the store by ID.
 * @param id - The file ID (e.g., "file_a3f8b2c1")
 * @returns The StoredFile object, or undefined if not found
 */
export function getFile(id: string): StoredFile | undefined {
    const file = fileStore.get(id);
    if (file) {
        console.log(`[FileStore] Retrieved file: ${id}`);
        return file;
    }

    console.warn(`[FileStore] File not found: ${id}`);
    return undefined;
}

/**
 * Check if a file exists in the store.
 */
/**
 * Get the most recently added file (last in the Map).
 * Returns the file with its ID, or undefined if store is empty.
 */
export function getLatestFile(): { id: string; file: StoredFile } | undefined {
    const keys = Array.from(fileStore.keys());
    if (keys.length === 0) return undefined;
    const lastId = keys[keys.length - 1];
    const file = fileStore.get(lastId);
    return file ? { id: lastId, file } : undefined;
}

/**
 * Check if a MIME type is an image
 */
export function isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
}
