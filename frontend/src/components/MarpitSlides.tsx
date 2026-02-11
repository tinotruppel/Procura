/**
 * MarpitSlides Component
 * Renders Marpit/Marp presentations from code blocks in chat messages
 */
import { useEffect, useRef, useState, memo, useMemo } from "react";
import { Marpit } from "@marp-team/marpit";
import { ChevronLeft, ChevronRight, Presentation, Maximize2 } from "lucide-react";

interface MarpitSlidesProps {
    code: string;
}

// Simple hash function for stable IDs
function hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Procura theme with brand styling and Container Query responsive sizing
const procuraTheme = `
/* @theme procura */

:root {
    --color-background: #1a1a2e;
    --color-background-gradient: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    --color-foreground: #ffffff;
    --color-primary: #8B5CF6;
    --color-secondary: #A78BFA;
    --color-accent: #C4B5FD;
    --color-muted: #6B7280;
}

section {
    font-family: 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif;
    /* Base font size relative to container width (approx 2.2% of width) */
    font-size: 2.2cqw;
    background: var(--color-background-gradient);
    color: var(--color-foreground);
    /* Padding relative to container width */
    padding: 3cqw 4.5cqw;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
}

h1 {
    color: var(--color-primary);
    font-size: 2.2em;
    font-weight: 700;
    border-bottom: 0.1em solid var(--color-primary);
    padding-bottom: 0.3em;
    margin-bottom: 0.5em;
}

h2 {
    color: var(--color-secondary);
    font-size: 1.4em;
    font-weight: 600;
    margin-top: 0;
}

h3 {
    color: var(--color-accent);
    font-size: 1.1em;
    font-weight: 600;
}

/* Lead/Title slides */
section.lead {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f23 100%);
}

section.lead h1 {
    font-size: 2.6em;
    border-bottom: none;
    color: var(--color-foreground);
}

section.lead h2 {
    font-size: 1.5em;
    color: var(--color-secondary);
    margin-top: 0.3em;
}

/* Typography */
p, li {
    font-size: 0.95em;
    line-height: 1.6;
}

li {
    margin-bottom: 0.4em;
}

strong {
    color: var(--color-accent);
}

/* Blockquotes */
blockquote {
    border-left: 0.3em solid var(--color-primary);
    padding: 0.5em 1em;
    margin: 1em 0;
    font-style: italic;
    color: #E0E7FF;
    background: rgba(139, 92, 246, 0.1);
    border-radius: 0 0.5em 0.5em 0;
}

blockquote p {
    margin: 0;
}

/* Tables */
table {
    font-size: 0.85em;
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
}

th {
    background: var(--color-primary);
    color: white;
    padding: 0.6em 1em;
    text-align: left;
    font-weight: 600;
}

td {
    background: transparent;
    color: var(--color-foreground);
    padding: 0.5em 1em;
    border-bottom: 1px solid rgba(139, 92, 246, 0.2);
}

tr:last-child td {
    border-bottom: none;
}

/* Code blocks */
pre {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 0.5em;
    padding: 1em;
    font-size: 0.8em;
}

code {
    font-family: 'Fira Code', 'Consolas', monospace;
    color: #E0E7FF;
}

/* Two-column layout */
.columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2em;
}

/* Three-column card layout */
.three-cols {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 1em;
    font-size: 0.85em;
}

.three-cols > div, .card {
    background: rgba(139, 92, 246, 0.1);
    padding: 0.8em;
    border-radius: 0.5em;
    border-left: 0.2em solid var(--color-primary);
}

.card h3, .three-cols strong {
    color: var(--color-secondary);
    margin-top: 0;
}

/* Two-column card layout */
.two-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1em;
    font-size: 0.9em;
}

.two-cols > div {
    background: rgba(139, 92, 246, 0.1);
    padding: 0.8em;
    border-radius: 0.5em;
    border-left: 0.2em solid var(--color-primary);
}

/* Footer/Pagination */
section::after {
    color: var(--color-muted);
    font-size: 0.7em;
}

/* Links */
a {
    color: var(--color-secondary);
    text-decoration: none;
}

a:hover {
    text-decoration: underline;
}

/* Images */
img {
    max-height: 60%;
    object-fit: contain;
}
`;

function MarpitSlidesInner({ code }: MarpitSlidesProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [slides, setSlides] = useState<string[]>([]);
    const [css, setCss] = useState<string>("");
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Create Marpit instance with memoization
    const marpit = useMemo(() => {
        const instance = new Marpit({
            markdown: {
                html: true,
            },
        });

        // Add procura theme
        instance.themeSet.default = instance.themeSet.add(procuraTheme);

        return instance;
    }, []);

    // Render slides when code changes
    useEffect(() => {
        try {
            setError(null);

            const { html, css: renderedCss } = marpit.render(code);

            // Parse the HTML to extract individual slides
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const sections = doc.querySelectorAll("section");

            if (sections.length === 0) {
                setError("No slides found in the Marpit code");
                return;
            }

            const slideContents: string[] = [];
            sections.forEach((section) => {
                // Ensure section uses full dimensions
                slideContents.push(section.outerHTML);
            });

            setSlides(slideContents);
            setCss(renderedCss);
            setCurrentSlide(0);
        } catch (err) {
            console.error("Marpit render error:", err);
            setError(err instanceof Error ? err.message : "Failed to render slides");
        }
    }, [code, marpit]);

    // Handle keyboard navigation
    useEffect(() => {
        if (!isFullscreen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                setCurrentSlide((prev) => Math.max(0, prev - 1));
            } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
                e.preventDefault();
                setCurrentSlide((prev) => Math.min(slides.length - 1, prev + 1));
            } else if (e.key === "Escape") {
                setIsFullscreen(false);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [slides.length, isFullscreen]);

    const handlePrevSlide = () => {
        setCurrentSlide((prev) => Math.max(0, prev - 1));
    };

    const handleNextSlide = () => {
        setCurrentSlide((prev) => Math.min(slides.length - 1, prev + 1));
    };

    const toggleFullscreen = () => {
        setIsFullscreen(!isFullscreen);
    };

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 my-2">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
                    <Presentation className="h-4 w-4" />
                    <span>Marpit Error: {error}</span>
                </div>
                <pre className="mt-2 text-xs text-red-500 dark:text-red-400 overflow-x-auto whitespace-pre-wrap">
                    {code.slice(0, 200)}...
                </pre>
            </div>
        );
    }

    if (slides.length === 0) {
        return (
            <div className="bg-muted rounded-lg p-4 my-2 flex items-center justify-center">
                <div className="animate-pulse flex items-center gap-2 text-muted-foreground">
                    <Presentation className="h-4 w-4" />
                    <span className="text-sm">Rendering slides...</span>
                </div>
            </div>
        );
    }

    // Fullscreen presentation view
    if (isFullscreen) {
        return (
            <div
                className="fixed inset-0 z-50 bg-black flex flex-col"
                onClick={toggleFullscreen}
            >
                {/* Scale fullscreen content based on viewport width using same cqw logic */}
                <div style={{ containerType: 'inline-size', width: '100%', height: '100%', position: 'absolute' }}>
                    <style dangerouslySetInnerHTML={{ __html: css }} />
                    <div
                        className="flex-1 flex items-center justify-center p-4 w-full h-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            className="marpit w-full max-w-[90vw] aspect-[16/9] shadow-2xl"
                            dangerouslySetInnerHTML={{ __html: slides[currentSlide] }}
                        />
                    </div>
                </div>

                {/* Navigation controls */}
                <div
                    className="flex items-center justify-center gap-4 p-4 bg-black/80 z-10 mt-auto w-full"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={handlePrevSlide}
                        disabled={currentSlide === 0}
                        className="p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft className="h-6 w-6 text-white" />
                    </button>
                    <span className="text-white text-sm font-medium">
                        {currentSlide + 1} / {slides.length}
                    </span>
                    <button
                        onClick={handleNextSlide}
                        disabled={currentSlide === slides.length - 1}
                        className="p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight className="h-6 w-6 text-white" />
                    </button>
                    <button
                        onClick={toggleFullscreen}
                        className="ml-4 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
                    >
                        Exit (Esc)
                    </button>
                </div>
            </div>
        );
    }

    // Inline preview
    return (
        <div
            ref={containerRef}
            className="relative w-full min-w-[250px] flex-shrink-0 block my-2 rounded-lg overflow-hidden border border-border bg-background"
            style={{ width: '100%' }}
        >
            <style dangerouslySetInnerHTML={{ __html: css }} />

            {/* Slide preview - uses CSS container queries for automatic scaling */}
            <div
                className="relative w-full"
                style={{
                    aspectRatio: '16 / 9',
                    containerType: 'inline-size'
                }}
            >
                <div
                    className="marpit absolute inset-0 w-full h-full"
                    dangerouslySetInnerHTML={{ __html: slides[currentSlide] }}
                />
            </div>

            {/* Navigation bar */}
            <div className="flex items-center justify-between p-2 bg-muted/50 border-t border-border">
                <div className="flex items-center gap-2">
                    <Presentation className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                        Slide {currentSlide + 1} of {slides.length}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handlePrevSlide}
                        disabled={currentSlide === 0}
                        className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Previous slide"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-medium px-2 min-w-[3rem] text-center">
                        {currentSlide + 1} / {slides.length}
                    </span>
                    <button
                        onClick={handleNextSlide}
                        disabled={currentSlide === slides.length - 1}
                        className="p-1.5 rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Next slide"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                        onClick={toggleFullscreen}
                        className="ml-2 p-1.5 rounded hover:bg-secondary transition-colors"
                        title="Fullscreen presentation"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

// Memoize with custom comparison to prevent unnecessary re-renders
export const MarpitSlides = memo(MarpitSlidesInner, (prevProps, nextProps) => {
    return prevProps.code === nextProps.code;
});

// Export hash function for use in MessageList
export { hashCode as hashCodeMarpit };
