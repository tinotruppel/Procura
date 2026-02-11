/**
 * MermaidDiagram Component
 * Renders Mermaid diagrams from code blocks in chat messages
 */
import { useEffect, useRef, useState, memo, useMemo } from "react";
import mermaid from "mermaid";

// Initialize Mermaid 
mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose", // Allows proper text rendering without escaping
    theme: "neutral",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    flowchart: {
        htmlLabels: false, // Disable HTML labels to prevent <p> tags
    },
});

interface MermaidDiagramProps {
    code: string;
}

// Simple hash function for stable IDs
function hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Encode special characters as HTML entities for Mermaid compatibility.
 * Even inside quoted labels, some characters can break Mermaid parsing.
 * Uses standard HTML entity names (not numeric codes) to avoid cascading replacements.
 * 
 * @param text - Label text to encode
 * @returns Text with problematic characters replaced by HTML entities
 */
function encodeForMermaid(text: string): string {
    // Use unique placeholders to avoid cascading replacements
    // These are Unicode private use area characters, unlikely to appear in real content
    const PLACEHOLDER_AMP = "\uE000";
    const PLACEHOLDER_LT = "\uE001";
    const PLACEHOLDER_GT = "\uE002";
    const PLACEHOLDER_HASH = "\uE003";
    const PLACEHOLDER_SEMI = "\uE004";

    return text
        // Handle <br/> and <br> tags first - before encoding < and >
        .replace(/<br\s*\/?>/gi, "\\n")
        // Escape double quotes by replacing with single quotes
        .replace(/"/g, "'")
        // Step 1: Replace all special chars with unique placeholders
        .replace(/&/g, PLACEHOLDER_AMP)
        .replace(/</g, PLACEHOLDER_LT)
        .replace(/>/g, PLACEHOLDER_GT)
        .replace(/#/g, PLACEHOLDER_HASH)
        .replace(/;/g, PLACEHOLDER_SEMI)
        // Step 2: Replace placeholders with HTML entities (no cascading possible)
        .replace(new RegExp(PLACEHOLDER_AMP, "g"), "&amp;")
        .replace(new RegExp(PLACEHOLDER_LT, "g"), "&lt;")
        .replace(new RegExp(PLACEHOLDER_GT, "g"), "&gt;")
        .replace(new RegExp(PLACEHOLDER_HASH, "g"), "&#35;")
        .replace(new RegExp(PLACEHOLDER_SEMI, "g"), "&#59;");
}

/**
 * Sanitize Mermaid code to prevent parsing errors from special characters.
 * Converts unquoted node labels with special characters to quoted format.
 * Uses an allow-list approach: only simple alphanumeric labels are left unquoted.
 * Also encodes problematic characters as HTML entities.
 * 
 * @param code - Raw Mermaid diagram code
 * @returns Sanitized code with problematic labels quoted and encoded
 */
export function sanitizeMermaidCode(code: string): string {
    // Allow-list: only these characters are safe unquoted in Mermaid labels
    // Letters, numbers, spaces, dots, commas, and hyphens (not at word boundaries)
    const safeCharsRegex = /^[a-zA-Z0-9 .,-]+$/;

    let sanitized = code;

    // FIRST: Handle already-quoted labels (can contain nested brackets)
    // Pattern: A["..."] where ... can contain any chars except unescaped "
    const quotedPatterns = [
        // Square brackets with quoted content: A["text with [brackets]"]
        /(\w+)\["([^"]*(?:\\"[^"]*)*)"\]/g, // eslint-disable-line sonarjs/slow-regex
        // Round brackets with quoted content: A("text")
        /(\w+)\("([^"]*(?:\\"[^"]*)*)"\)(?!\))/g, // eslint-disable-line sonarjs/slow-regex
        // Curly brackets with quoted content: A{"text"}
        /(\w+)\{"([^"]*(?:\\"[^"]*)*)"}/g, // eslint-disable-line sonarjs/slow-regex
    ];

    for (const pattern of quotedPatterns) {
        sanitized = sanitized.replace(pattern, (_match, nodeId, innerLabel) => {
            // Encode problematic characters inside the quoted label
            const encodedLabel = encodeForMermaid(innerLabel);
            const openBracket = _match.charAt(nodeId.length);
            const closeBracket = _match.charAt(_match.length - 1);
            return `${nodeId}${openBracket}"${encodedLabel}"${closeBracket}`;
        });
    }

    // SECOND: Handle unquoted labels (simple content, no nested brackets)
    // These patterns run AFTER quoted patterns, so A["..."] nodes are already processed
    const unquotedPatterns = [
        // Square brackets: A[text]
        /(\w+)\[([^\]]+)\]/g, // eslint-disable-line sonarjs/slow-regex
        // Round brackets (stadium): A(text) - but not A((text)) for circles
        /(\w+)\(([^()]+)\)(?!\))/g, // eslint-disable-line sonarjs/slow-regex
        // Curly brackets (rhombus): A{text}
        /(\w+)\{([^{}]+)\}/g, // eslint-disable-line sonarjs/slow-regex
    ];

    for (const pattern of unquotedPatterns) {
        sanitized = sanitized.replace(pattern, (match, nodeId, label) => {
            // Skip if label is already quoted (processed by quoted patterns above)
            if (label.startsWith('"') && label.endsWith('"')) {
                return match;
            }

            // Check if label contains any non-safe characters
            const needsQuoting = !safeCharsRegex.test(label);

            if (needsQuoting) {
                // Encode problematic characters for Mermaid
                const encodedLabel = encodeForMermaid(label);
                // Return with the same bracket type, quoted
                const openBracket = match.charAt(nodeId.length);
                const closeBracket = match.charAt(match.length - 1);
                return `${nodeId}${openBracket}"${encodedLabel}"${closeBracket}`;
            }

            return match;
        });
    }

    // Also handle edge labels in |"text"| format
    sanitized = sanitized.replace(/\|"([^"]+)"\|/g, (_match, label) => {
        const encodedLabel = encodeForMermaid(label);
        return `|"${encodedLabel}"|`;
    });

    // Handle subgraph labels: subgraph ID["text"]
    sanitized = sanitized.replace(/subgraph\s+(\w+)\["([^"]+)"\]/g, (_match, id, label) => {
        const encodedLabel = encodeForMermaid(label);
        return `subgraph ${id}["${encodedLabel}"]`;
    });

    return sanitized;
}

function MermaidDiagramInner({ code }: MermaidDiagramProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [svg, setSvg] = useState<string | null>(null);
    const renderedCodeRef = useRef<string | null>(null);

    // Stable ID based on code content
    const diagramId = useMemo(() => `mermaid-${hashCode(code)}`, [code]);

    useEffect(() => {
        // Skip if already rendered this exact code
        if (renderedCodeRef.current === code && svg) {
            return;
        }

        const renderDiagram = async () => {
            if (!code.trim()) return;

            try {
                // Sanitize the code to handle special characters in labels
                const sanitizedCode = sanitizeMermaidCode(code.trim());
                // Render the diagram
                const result = await mermaid.render(diagramId, sanitizedCode);
                setSvg(result.svg);
                setError(null);
                renderedCodeRef.current = code;
            } catch (err) {
                console.error("[MermaidDiagram] Render error:", err);
                setError(err instanceof Error ? err.message : "Failed to render diagram");
                setSvg(null);
                renderedCodeRef.current = null;

                // Cleanup any error SVGs that Mermaid may have added to the DOM
                const errorSvg = document.getElementById(diagramId);
                if (errorSvg) {
                    errorSvg.remove();
                }
            }
        };

        renderDiagram();
    }, [code, diagramId, svg]);

    if (error) {
        return (
            <div className="my-2 rounded-md border border-red-500/30 bg-red-500/10 p-3">
                <div className="text-xs text-red-400 mb-2">⚠️ Mermaid Error: {error}</div>
                <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                    {code}
                </pre>
            </div>
        );
    }

    if (svg) {
        return (
            <div
                ref={containerRef}
                className="mermaid-container my-2 overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        );
    }

    // Initial loading state (only shown on first render)
    return (
        <div ref={containerRef} className="my-2 rounded-md bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            Rendering diagram...
        </div>
    );
}

// Memoize with custom comparison to prevent unnecessary re-renders
export const MermaidDiagram = memo(MermaidDiagramInner, (prevProps, nextProps) => {
    return prevProps.code === nextProps.code;
});
