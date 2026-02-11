/**
 * Chat export utilities - pure functions for exporting chat data
 */
import { ChatMessage } from "@/lib/llm-types";

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get emoji icon for file type based on MIME type
 */
export function getFileIcon(mimeType: string): string {
    if (mimeType.startsWith("audio/")) return "🎵";
    if (mimeType.startsWith("video/")) return "🎬";
    if (mimeType === "application/pdf") return "📄";
    if (mimeType === "application/json") return "📋";
    if (mimeType.includes("zip") || mimeType.includes("compressed")) return "📦";
    if (mimeType.startsWith("text/")) return "📝";
    return "📎";
}

/**
 * Format timestamp as relative or absolute date string
 */
export function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;

    if (diff < 86400000) {
        // less than 24h
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diff < 604800000) {
        // less than 7 days
        return date.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Convert chat messages to markdown format
 */
export function messagesToMarkdown(messages: ChatMessage[], title: string): string {
    const exportDate = new Date().toLocaleString();
    let markdown = `# ${title}\n_Exported: ${exportDate}_\n\n---\n\n`;

    for (const msg of messages) {
        if (msg.role === "user") {
            markdown += `## 👤 User\n${msg.content}\n\n`;
        } else if (msg.role === "model") {
            markdown += `## 🤖 Assistant\n${msg.content}\n\n`;

            // Include tool calls if present
            if (msg.toolCalls && msg.toolCalls.length > 0) {
                for (const toolCall of msg.toolCalls) {
                    markdown += `### 🔧 Tool: ${toolCall.name}\n`;
                    markdown += `**Arguments:**\n\`\`\`json\n${JSON.stringify(toolCall.args, null, 2)}\n\`\`\`\n`;
                    if (toolCall.result) {
                        const resultStr = toolCall.result.success
                            ? JSON.stringify(toolCall.result.data, null, 2)
                            : toolCall.result.error || "Error";
                        markdown += `**Result:** ${toolCall.result.success ? "✅" : "❌"}\n\`\`\`json\n${resultStr}\n\`\`\`\n`;
                    }
                    markdown += "\n";
                }
            }
        }
        markdown += "---\n\n";
    }

    return markdown;
}

/**
 * Download content as a file
 */
export function downloadAsFile(content: string, filename: string, mimeType: string = "text/markdown"): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Export chat messages as markdown file (convenience function)
 */
export function exportChatAsMarkdown(messages: ChatMessage[], title: string): void {
    const markdown = messagesToMarkdown(messages, title);
    const filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
    downloadAsFile(markdown, filename);
}
