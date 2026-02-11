import { ChatMessage, ToolCallInfo, LLMDebugInfo, PROVIDER_LABELS } from "@/lib/llm-types";
import { cn } from "@/lib/utils";
import { Calculator, Camera, Globe, MapPin, Server, CheckCircle, XCircle, ChevronDown, ChevronRight, Clock, Copy, Check, Sparkles, ThumbsUp, ThumbsDown, X, Send, GitBranch } from "lucide-react";
import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LangfuseConfig } from "@/lib/storage";
import { sendLangfuseScore } from "@/lib/langfuse";
import { MermaidDiagram } from "./MermaidDiagram";
import { MarpitSlides } from "./MarpitSlides";
import { parse as twemojiParse } from "twemoji-parser";
import { getFile } from "@/lib/file-store";

/**
 * Replace Unicode emojis with Twemoji images for consistent rendering
 */
function replaceEmojisWithTwemoji(text: string): React.ReactNode[] {
    const entities = twemojiParse(text);
    if (entities.length === 0) {
        return [text];
    }

    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    for (const entity of entities) {
        // Add text before emoji
        if (entity.indices[0] > lastIndex) {
            result.push(text.slice(lastIndex, entity.indices[0]));
        }
        // Add emoji image - use inline and vertical-align to prevent line breaks
        result.push(
            <img
                key={`emoji-${entity.indices[0]}`}
                src={entity.url}
                alt={entity.text}
                style={{ display: 'inline', height: '1.2em', width: '1.2em', verticalAlign: '-0.2em', margin: '0 0.05em' }}
                draggable={false}
            />
        );
        lastIndex = entity.indices[1];
    }

    // Add remaining text after last emoji
    if (lastIndex < text.length) {
        result.push(text.slice(lastIndex));
    }

    return result;
}

interface MessageListProps {
    messages: ChatMessage[];
    scrollRef?: React.RefObject<HTMLDivElement>;
    debugMode?: boolean;
    langfuseConfig?: LangfuseConfig;
    isStreaming?: boolean;
    onFork?: (messageIndex: number) => void;
}

// Simple hash function for stable keys
function hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Pre block with copy button
function PreWithCopy({ children }: { children?: React.ReactNode }) {
    const [copied, setCopied] = useState(false);

    // Extract code content from child code element
    const child = children as React.ReactElement;

    // Check if this pre contains a Mermaid diagram or Marpit slides - render without wrapper
    if (child?.type === MermaidDiagram || child?.type === MarpitSlides) {
        return <>{children}</>;
    }

    // Extract code string from the code element's children
    const codeContent = child?.props?.children;
    const codeString = typeof codeContent === 'string'
        ? codeContent.replace(/\n$/, '')
        : String(codeContent || '').replace(/\n$/, '');

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(codeString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy code:", err);
        }
    };

    return (
        <div className="relative group">
            <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-1 rounded bg-secondary/80 hover:bg-secondary opacity-0 group-hover:opacity-100 transition-opacity z-10"
                title="Copy code"
            >
                {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
            </button>
            <pre>{children}</pre>
        </div>
    );
}
// Recursively process React children to replace emoji strings with Twemoji images
function processChildrenWithEmojis(children: React.ReactNode): React.ReactElement {
    // Handle null/undefined
    if (children === null || children === undefined) {
        return <></>;
    }
    // Handle strings - replace emojis
    if (typeof children === 'string') {
        return <>{replaceEmojisWithTwemoji(children)}</>;
    }
    // Handle numbers/booleans - return wrapped
    if (typeof children === 'number' || typeof children === 'boolean') {
        return <>{children}</>;
    }
    // Handle arrays
    if (Array.isArray(children)) {
        return (
            <>
                {children.map((child, index) => (
                    <React.Fragment key={index}>{processChildrenWithEmojis(child)}</React.Fragment>
                ))}
            </>
        );
    }
    // Handle React elements - clone with processed children
    if (React.isValidElement(children)) {
        // Void elements (img, br, hr, input, etc.) cannot have children
        const voidElements = ['img', 'br', 'hr', 'input', 'area', 'base', 'col', 'embed', 'link', 'meta', 'source', 'track', 'wbr'];
        const elementType = children.type;
        if (typeof elementType === 'string' && voidElements.includes(elementType)) {
            // Return void elements as-is without trying to add children
            return <>{children}</>;
        }
        try {
            const childProps = children.props as { children?: React.ReactNode };
            return React.cloneElement(
                children,
                undefined,
                processChildrenWithEmojis(childProps.children)
            );
        } catch {
            // If cloneElement fails, return original wrapped
            return <>{children}</>;
        }
    }
    // For any other type (symbols, iterables, etc.), return wrapped
    return <>{children}</>;
}

/**
 * Pre-process Marpit blocks with nested code fences.
 * Standard markdown parsers close a ```marpit block at the first ```.
 * This function converts ```marpit to ````marpit (4 backticks) when nested code exists,
 * which allows standard markdown parsing to work correctly.
 */
function preprocessMarpitBlocks(content: string): string {
    // Simple approach: find ```marpit or ```marp blocks and check for nested code
    // If nested code found, convert to 4-backtick fences

    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Check for Marpit opening fence: ```marpit or ```marp
        const openMatch = /^(`{3,})(marpit|marp)\s*$/.exec(line);
        if (openMatch) {
            const fenceLength = openMatch[1].length;
            const language = openMatch[2];

            // Find the matching closing fence
            // For nested code, we need to track inner fence pairs
            let depth = 1;
            let j = i + 1;
            const blockLines: string[] = [line];

            while (j < lines.length && depth > 0) {
                const innerLine = lines[j];
                blockLines.push(innerLine);

                // Check for opening code fence (``` followed by language)
                if (/^`{3,}\w+\s*$/.test(innerLine)) {
                    depth++;
                }
                // Check for closing fence (``` alone or with whitespace)
                else if (/^`{3,}\s*$/.test(innerLine)) {
                    depth--;
                }
                j++;
            }

            // Check if block has nested code (depth went above 1 at some point)
            const blockContent = blockLines.slice(1, -1).join('\n'); // Exclude opening and closing fences
            const hasNestedCode = /^```\w+/m.test(blockContent);

            if (hasNestedCode && fenceLength === 3) {
                // Convert to 4-backtick fence
                result.push('````' + language);
                result.push(...blockLines.slice(1, -1)); // Inner content unchanged
                result.push('````');
            } else {
                // No nested code or already using extended fence, keep as-is
                result.push(...blockLines);
            }

            i = j;
            continue;
        }

        // Also check for plain ``` with marp: true frontmatter
        const plainFenceMatch = /^(`{3,})\s*$/.exec(line);
        if (plainFenceMatch && i + 1 < lines.length && lines[i + 1] === '---') {
            // Look ahead for marp: true in frontmatter
            let frontmatterEnd = -1;
            for (let k = i + 2; k < Math.min(i + 20, lines.length); k++) {
                if (lines[k] === '---') {
                    frontmatterEnd = k;
                    break;
                }
            }

            if (frontmatterEnd !== -1) {
                const frontmatter = lines.slice(i + 1, frontmatterEnd + 1).join('\n');
                if (frontmatter.includes('marp: true')) {
                    const fenceLength = plainFenceMatch[1].length;

                    // Find closing fence with depth tracking
                    let depth = 1;
                    let j = i + 1;
                    const blockLines: string[] = [line];

                    while (j < lines.length && depth > 0) {
                        const innerLine = lines[j];
                        blockLines.push(innerLine);

                        if (/^`{3,}\w+\s*$/.test(innerLine)) {
                            depth++;
                        } else if (/^`{3,}\s*$/.test(innerLine)) {
                            depth--;
                        }
                        j++;
                    }

                    const blockContent = blockLines.slice(1, -1).join('\n');
                    const hasNestedCode = /^```\w+/m.test(blockContent);

                    if (hasNestedCode && fenceLength === 3) {
                        result.push('````');
                        result.push(...blockLines.slice(1, -1));
                        result.push('````');
                    } else {
                        result.push(...blockLines);
                    }

                    i = j;
                    continue;
                }
            }
        }

        result.push(line);
        i++;
    }

    return result.join('\n');
}

// Memoized Markdown component to prevent re-renders when parent state changes
const MemoizedMarkdown = memo(function MemoizedMarkdown({ content }: { content: string }) {
    // Preprocess content to handle nested code blocks in Marpit
    const processedContent = useMemo(() => preprocessMarpitBlocks(content), [content]);
    // Memoize components object to keep stable reference
    const components = useMemo(() => ({
        // Process paragraphs to replace emojis with Twemoji images
        p: ({ children }: { children?: React.ReactNode }) => (
            <p>{processChildrenWithEmojis(children)}</p>
        ),
        // Headings
        h1: ({ children }: { children?: React.ReactNode }) => <h1>{processChildrenWithEmojis(children)}</h1>,
        h2: ({ children }: { children?: React.ReactNode }) => <h2>{processChildrenWithEmojis(children)}</h2>,
        h3: ({ children }: { children?: React.ReactNode }) => <h3>{processChildrenWithEmojis(children)}</h3>,
        h4: ({ children }: { children?: React.ReactNode }) => <h4>{processChildrenWithEmojis(children)}</h4>,
        h5: ({ children }: { children?: React.ReactNode }) => <h5>{processChildrenWithEmojis(children)}</h5>,
        h6: ({ children }: { children?: React.ReactNode }) => <h6>{processChildrenWithEmojis(children)}</h6>,
        // List items
        li: ({ children }: { children?: React.ReactNode }) => <li>{processChildrenWithEmojis(children)}</li>,
        // Table cells
        td: ({ children }: { children?: React.ReactNode }) => <td>{processChildrenWithEmojis(children)}</td>,
        th: ({ children }: { children?: React.ReactNode }) => <th>{processChildrenWithEmojis(children)}</th>,
        // Blockquote
        blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote>{processChildrenWithEmojis(children)}</blockquote>,
        // Inline formatting
        strong: ({ children }: { children?: React.ReactNode }) => <strong>{processChildrenWithEmojis(children)}</strong>,
        em: ({ children }: { children?: React.ReactNode }) => <em>{processChildrenWithEmojis(children)}</em>,
        // Links
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
                {processChildrenWithEmojis(children)}
            </a>
        ),
        // Images - resolve file_xxx references from file-store
        img: ({ src, alt, node: _node }: { src?: string; alt?: string; node?: unknown }) => {
            try {
                // Check if src is a file-store reference (file_xxxxxxxx format)
                if (src && /^file_[a-f0-9]{8}$/.test(src)) {
                    const storedFile = getFile(src);
                    if (storedFile) {
                        return (
                            <img
                                src={storedFile.dataUrl}
                                alt={alt || "Generated image"}
                                className="max-w-full h-auto rounded-lg shadow-md my-2"
                            />
                        );
                    }
                    // File reference not found (session expired / data lost)
                    return (
                        <div className="inline-flex items-center gap-2 px-3 py-2 my-2 rounded-lg bg-muted/50 border border-border text-muted-foreground text-sm">
                            <span className="text-lg">🖼️</span>
                            <span>{alt || "Image"} <span className="opacity-60">({src} - expired)</span></span>
                        </div>
                    );
                }
                // Regular image URL
                return <img src={src} alt={alt} className="max-w-full h-auto rounded-lg" />;
            } catch (error) {
                console.error('[MessageList] Image render error:', error);
                return (
                    <div className="inline-flex items-center gap-2 px-3 py-2 my-2 rounded-lg bg-destructive/10 border border-destructive/50 text-destructive text-sm">
                        <span>⚠️</span>
                        <span>Image failed to load</span>
                    </div>
                );
            }
        },
        // Custom pre renderer with copy button
        pre: PreWithCopy,
        code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => {

            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            const codeString = String(children).replace(/\n$/, "");

            // Render Mermaid diagrams with stable key
            if (language === "mermaid") {
                return <MermaidDiagram key={`mermaid-${hashCode(codeString)}`} code={codeString} />;
            }

            // Render Marpit/Marp slides - detect by language or frontmatter
            const isMarpitLanguage = language === "marpit" || language === "marp";
            // Check for marp: true in YAML frontmatter (first 500 chars to avoid ReDoS)
            const hasMarpFrontmatter = codeString.startsWith("---") &&
                codeString.slice(0, 500).includes("marp: true") &&
                codeString.slice(4, 500).includes("---");
            if (isMarpitLanguage || hasMarpFrontmatter) {
                return <MarpitSlides key={`marpit-${hashCode(codeString)}`} code={codeString} />;
            }

            // Default code rendering (block and inline)
            return (
                <code className={className} {...props}>
                    {children}
                </code>
            );
        },
    }), []);

    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {processedContent}
        </ReactMarkdown>
    );
}, (prevProps, nextProps) => prevProps.content === nextProps.content);

const toolIcons: Record<string, React.ReactNode> = {
    calculator: <Calculator className="h-4 w-4" />,
    screenshot: <Camera className="h-4 w-4" />,
    http_request: <Globe className="h-4 w-4" />,
    geolocation: <MapPin className="h-4 w-4" />,
    datetime: <Clock className="h-4 w-4" />,
};

// eslint-disable-next-line sonarjs/function-return-type -- intentional: returns looked up icon or default Globe
function getToolIcon(toolName: string): React.ReactNode {
    // Check for MCP tool prefix
    if (toolName.startsWith("mcp_")) {
        return <Server className="h-4 w-4" />;
    }
    return toolIcons[toolName] || <Globe className="h-4 w-4" />;
}

function getDisplayToolName(toolName: string): string {
    // Remove MCP prefix for display (mcp_12345678_toolname -> toolname)
    if (toolName.startsWith("mcp_")) {
        const parts = toolName.split("_");
        return parts.slice(2).join("_");
    }
    return toolName;
}

function getFileDisplayIcon(mimeType: string): string {
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType === 'application/pdf') return '📄';
    if (mimeType === 'application/json') return '📋';
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦';
    if (mimeType.startsWith('text/')) return '📝';
    return '📎';
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCallInfo }) {
    const [expanded, setExpanded] = useState(false);
    const icon = getToolIcon(toolCall.name);
    const displayName = getDisplayToolName(toolCall.name);
    const success = toolCall.result?.success;

    // Format JSON nicely for display
    const formatData = (data: unknown) => {
        if (typeof data === "object") {
            return JSON.stringify(data, null, 2);
        }
        return String(data);
    };

    return (
        <div className="bg-secondary/50 rounded-md text-xs overflow-hidden">
            {/* Header - clickable */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 p-2 hover:bg-secondary/70 transition-colors"
            >
                {expanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                <div className="flex items-center gap-1.5 text-muted-foreground">
                    {icon}
                    <span className="font-medium">{displayName}</span>
                </div>
                <span className="text-muted-foreground/70 truncate flex-1 text-left">
                    {JSON.stringify(toolCall.args)}
                </span>
                {toolCall.result && (
                    success ? (
                        <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
                    ) : (
                        <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
                    )
                )}
            </button>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-border p-2 space-y-2">
                    <div>
                        <div className="text-muted-foreground font-medium mb-1">Arguments:</div>
                        <pre className="bg-background p-2 rounded text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                            {formatData(toolCall.args)}
                        </pre>
                    </div>
                    {toolCall.result && (
                        <div>
                            <div className={cn(
                                "font-medium mb-1 flex items-center gap-2",
                                success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                            )}>
                                {success ? "Result:" : "Error:"}
                                {toolCall.durationMs !== undefined && (
                                    <span className="text-muted-foreground font-normal text-[10px]">
                                        ({toolCall.durationMs}ms)
                                    </span>
                                )}
                            </div>
                            <pre className="bg-background p-2 rounded text-[10px] overflow-x-auto whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                                {success
                                    ? formatData(toolCall.result.data)
                                    : toolCall.result.error
                                }
                            </pre>
                        </div>
                    )}
                    {toolCall.observationId && (
                        <div className="flex gap-2 text-[10px] pt-1 border-t border-border">
                            <span className="text-muted-foreground">Observation ID:</span>
                            <span className="font-mono text-[9px] text-muted-foreground">{toolCall.observationId}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function LLMDebugDisplay({ debug }: { debug: LLMDebugInfo }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="bg-secondary/50 rounded-md text-xs overflow-hidden">
            {/* Header - clickable */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 p-2 hover:bg-secondary/70 transition-colors"
            >
                {expanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Sparkles className="h-4 w-4" />
                    <span className="font-medium">LLM</span>
                </div>
                <span className="text-muted-foreground/70 truncate flex-1 text-left">
                    {debug.model} • {debug.durationMs}ms
                    {debug.totalTokens !== undefined && ` • ${debug.totalTokens} tokens`}
                </span>
                <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
            </button>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-border p-2 space-y-1 text-[10px]">
                    {debug.provider && (
                        <div className="flex gap-4">
                            <span className="text-muted-foreground">Provider:</span>
                            <span className="font-medium">
                                {PROVIDER_LABELS[debug.provider as keyof typeof PROVIDER_LABELS] || debug.provider}
                            </span>
                        </div>
                    )}
                    {debug.baseUrl && (
                        <div className="flex gap-4">
                            <span className="text-muted-foreground">Base URL:</span>
                            <span className="font-medium truncate max-w-[200px]" title={debug.baseUrl}>
                                {debug.baseUrl}
                            </span>
                        </div>
                    )}
                    <div className="flex gap-4">
                        <span className="text-muted-foreground">Model:</span>
                        <span className="font-medium">{debug.model}</span>
                    </div>
                    {debug.systemPromptName && (
                        <div className="flex gap-4">
                            <span className="text-muted-foreground">System Prompt:</span>
                            <span className="font-medium">
                                {debug.systemPromptName}
                                <span className="text-muted-foreground ml-1">
                                    ({debug.systemPromptSource === "langfuse" ? "Langfuse" : "Local"})
                                </span>
                            </span>
                        </div>
                    )}
                    {debug.injectedMemoryCount && debug.injectedMemoryCount > 0 && (
                        <div className="flex gap-4">
                            <span className="text-muted-foreground">Injected Memories:</span>
                            <span className="font-medium text-purple-600 dark:text-purple-400">
                                {debug.injectedMemoryCount}
                            </span>
                        </div>
                    )}
                    {debug.missingVariables && debug.missingVariables.length > 0 && (
                        <div className="flex gap-4 text-amber-600 dark:text-amber-400">
                            <span className="text-muted-foreground">⚠️ Missing Variables:</span>
                            <span className="font-medium">{debug.missingVariables.map(v => `{{${v}}}`).join(", ")}</span>
                        </div>
                    )}
                    <div className="flex gap-4">
                        <span className="text-muted-foreground">Duration:</span>
                        <span className="font-medium">{debug.durationMs}ms</span>
                    </div>
                    {debug.totalTokens !== undefined && (
                        <>
                            <div className="flex gap-4">
                                <span className="text-muted-foreground">Input Tokens:</span>
                                <span className="font-medium">{debug.inputTokens}</span>
                            </div>
                            <div className="flex gap-4">
                                <span className="text-muted-foreground">Output Tokens:</span>
                                <span className="font-medium">{debug.outputTokens}</span>
                            </div>
                            <div className="flex gap-4">
                                <span className="text-muted-foreground">Total Tokens:</span>
                                <span className="font-medium">{debug.totalTokens}</span>
                            </div>
                        </>
                    )}
                    {debug.observationId && (
                        <div className="flex gap-4">
                            <span className="text-muted-foreground">Observation ID:</span>
                            <span className="font-mono text-[9px] text-muted-foreground">{debug.observationId}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

interface ModelMessageProps {
    content: string;
    traceId?: string;
    langfuseConfig?: LangfuseConfig;
    isStreaming?: boolean;
    onFork?: () => void;
    timestamp?: number;
}

function ModelMessage({ content, traceId, langfuseConfig, isStreaming, onFork, timestamp }: ModelMessageProps) {
    const [copied, setCopied] = useState(false);
    const [feedbackState, setFeedbackState] = useState<"none" | "up" | "down">("none");
    const [showFeedbackForm, setShowFeedbackForm] = useState(false);
    const [feedbackComment, setFeedbackComment] = useState("");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const handleThumbsClick = (value: "up" | "down") => {
        setFeedbackState(value);
        setShowFeedbackForm(true);
    };

    useEffect(() => {
        if (showFeedbackForm && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [showFeedbackForm]);

    const handleSubmitFeedback = async () => {
        if (!traceId || !langfuseConfig) return;
        setSending(true);
        try {
            await sendLangfuseScore(langfuseConfig, {
                traceId,
                name: "user-feedback",
                value: feedbackState === "up" ? 1 : -1,
                comment: feedbackComment.trim() || undefined,
            });
            setSent(true);
            setShowFeedbackForm(false);
        } catch (err) {
            console.error("Failed to send feedback:", err);
        } finally {
            setSending(false);
        }
    };

    const handleCancelFeedback = () => {
        setShowFeedbackForm(false);
        setFeedbackState("none");
        setFeedbackComment("");
    };

    const showFeedbackIcons = langfuseConfig?.enabled && traceId && !sent && !isStreaming;
    const showCopyIcon = !showFeedbackForm && !isStreaming;

    // Don't render anything if there's no content yet
    if (!content) {
        return null;
    }

    return (
        <div className="relative">
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-pre:my-2 prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none pb-6">
                <MemoizedMarkdown content={content} />
            </div>
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between">
                {/* Timestamp on the left */}
                <span className="text-xs text-muted-foreground">
                    {timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
                {/* Icons on the right */}
                <div className="flex items-center gap-1">
                    {showFeedbackIcons && !showFeedbackForm && (
                        <>
                            <button
                                onClick={() => handleThumbsClick("up")}
                                className={cn(
                                    "p-1.5 rounded transition-colors",
                                    feedbackState === "up"
                                        ? "bg-green-500/20 text-green-600"
                                        : "bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground"
                                )}
                                title="Good response"
                            >
                                <ThumbsUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => handleThumbsClick("down")}
                                className={cn(
                                    "p-1.5 rounded transition-colors",
                                    feedbackState === "down"
                                        ? "bg-red-500/20 text-red-600"
                                        : "bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground"
                                )}
                                title="Bad response"
                            >
                                <ThumbsDown className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}
                    {sent && (
                        <span className="text-xs text-green-600 flex items-center gap-1 px-2">
                            <Check className="h-3 w-3" /> Feedback sent
                        </span>
                    )}
                    {showCopyIcon && onFork && (
                        <button
                            onClick={onFork}
                            className="p-1.5 rounded bg-secondary/60 hover:bg-secondary transition-colors"
                            title="Fork conversation from here"
                        >
                            <GitBranch className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                        </button>
                    )}
                    {showCopyIcon && (
                        <button
                            onClick={handleCopy}
                            className="p-1.5 rounded bg-secondary/60 hover:bg-secondary transition-colors"
                            title="Copy raw markdown"
                        >
                            {copied ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                                <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                            )}
                        </button>
                    )}
                </div>
            </div>
            {/* Inline feedback form */}
            {showFeedbackForm && (
                <div className="mt-2 p-3 bg-secondary/30 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            {feedbackState === "up" ? (
                                <><ThumbsUp className="h-3 w-3 text-green-600" /> Good response</>
                            ) : (
                                <><ThumbsDown className="h-3 w-3 text-red-600" /> Bad response</>
                            )}
                        </span>
                        <button
                            onClick={handleCancelFeedback}
                            className="p-1 rounded hover:bg-secondary transition-colors"
                            title="Cancel"
                        >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                    </div>
                    <textarea
                        ref={textareaRef}
                        value={feedbackComment}
                        onChange={(e) => setFeedbackComment(e.target.value)}
                        placeholder="Optional: Add more details..."
                        className="w-full p-2 text-sm bg-background border border-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        rows={2}
                    />
                    <div className="flex justify-end mt-2">
                        <button
                            onClick={handleSubmitFeedback}
                            disabled={sending}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                            <Send className="h-3 w-3" />
                            {sending ? "Sending..." : "Send Feedback"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function MessageList({ messages, scrollRef, debugMode, langfuseConfig, isStreaming, onFork }: MessageListProps) {
    if (messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
                <div className="text-center">
                    <div className="text-4xl mb-4">💬</div>
                    <p>Start a chat</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message, index) => (
                <div
                    key={index}
                    className={cn(
                        "flex flex-col gap-2",
                        message.role === "user" ? "items-end" : "items-start"
                    )}
                >
                    {/* Debug events in sequence (only in debug mode) */}
                    {debugMode && message.role === "model" && message.debugEvents && message.debugEvents.length > 0 && (
                        <div className="w-full max-w-[85%] space-y-1">
                            {message.debugEvents.map((event, eventIndex) => (
                                event.type === 'tool' ? (
                                    <ToolCallDisplay key={eventIndex} toolCall={event.info} />
                                ) : (
                                    <LLMDebugDisplay key={eventIndex} debug={event.info} />
                                )
                            ))}
                        </div>
                    )}

                    {/* Message content */}
                    <div
                        className={cn(
                            "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                            message.role === "user"
                                ? "bg-primary text-primary-foreground"
                                : "w-full bg-muted text-foreground",
                            // Shimmer effect while streaming
                            message.role === "model" && isStreaming && index === messages.length - 1 && "animate-shimmer"
                        )}
                    >
                        {/* Images (for user messages) */}
                        {message.role === "user" && message.images && message.images.length > 0 && (
                            <div className="flex gap-2 mb-2 flex-wrap">
                                {message.images.map((img, imgIdx) => (
                                    <img
                                        key={imgIdx}
                                        src={img}
                                        alt={`Attached ${imgIdx + 1}`}
                                        className="w-16 h-16 object-cover rounded-md border border-primary-foreground/20"
                                    />
                                ))}
                            </div>
                        )}
                        {/* Files (for user messages) */}
                        {message.role === "user" && message.files && message.files.length > 0 && (
                            <div className="flex gap-2 mb-2 flex-wrap">
                                {message.files.map((file, fileIdx) => (
                                    <div key={fileIdx} className="flex items-center gap-1.5 bg-primary-foreground/10 rounded px-2 py-1">
                                        <span className="text-sm">{getFileDisplayIcon(file.mimeType)}</span>
                                        <span className="text-xs truncate max-w-[100px]" title={file.fileName}>
                                            {file.fileName}
                                        </span>
                                        <span className="text-[10px] opacity-70">
                                            {formatBytes(file.fileSize)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {message.role === "user" ? (
                            <div className="whitespace-pre-wrap break-words">
                                {processChildrenWithEmojis(message.content)}
                            </div>
                        ) : (
                            <ModelMessage
                                content={message.content}
                                traceId={message.traceId}
                                langfuseConfig={langfuseConfig}
                                isStreaming={isStreaming && index === messages.length - 1}
                                onFork={onFork ? () => onFork(index) : undefined}
                                timestamp={message.timestamp}
                            />
                        )}
                    </div>
                </div>
            ))}
            <div ref={scrollRef} />
        </div>
    );
}
