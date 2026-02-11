/**
 * Tests for MermaidDiagram sanitization
 */
import { describe, it, expect } from "vitest";
import { sanitizeMermaidCode } from "./MermaidDiagram";

describe("sanitizeMermaidCode", () => {
    describe("safe characters - should not be quoted", () => {
        it("should not modify simple alphanumeric labels", () => {
            const code = "A[Start] --> B[End]";
            expect(sanitizeMermaidCode(code)).toBe(code);
        });

        it("should not modify labels with spaces", () => {
            const code = "A[Hello World] --> B[End Node]";
            expect(sanitizeMermaidCode(code)).toBe(code);
        });

        it("should not modify labels with dots and commas", () => {
            const code = "A[Step 1, 2, 3] --> B[Version 1.0.0]";
            expect(sanitizeMermaidCode(code)).toBe(code);
        });

        it("should not modify labels with hyphens", () => {
            const code = "A[Pre-process] --> B[Post-process]";
            expect(sanitizeMermaidCode(code)).toBe(code);
        });
    });

    describe("HTML entity encoding - should encode problematic chars", () => {
        it("should encode hash as HTML entity", () => {
            const code = "A[Topic #1] --> B";
            // # becomes &#35;
            expect(sanitizeMermaidCode(code)).toBe('A["Topic &#35;1"] --> B');
        });

        it("should encode semicolon as HTML entity", () => {
            const code = "A[A; B] --> B";
            // ; becomes &#59;
            expect(sanitizeMermaidCode(code)).toBe('A["A&#59; B"] --> B');
        });

        it("should encode ampersand as HTML entity", () => {
            const code = "A[A & B] --> B";
            // & becomes &amp;
            expect(sanitizeMermaidCode(code)).toBe('A["A &amp; B"] --> B');
        });

        it("should encode angle brackets as HTML entities", () => {
            const code = "A[Element <tag>] --> B";
            // < becomes &lt; and > becomes &gt;
            expect(sanitizeMermaidCode(code)).toBe('A["Element &lt;tag&gt;"] --> B');
        });

        it("should encode all problematic chars in complex label", () => {
            const code = "A[#1; <x> & y] --> B";
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("&#35;");
            expect(result).toContain("&#59;");
            expect(result).toContain("&amp;");
            expect(result).toContain("&lt;");
            expect(result).toContain("&gt;");
        });
    });

    describe("special characters - should be quoted", () => {
        it("should quote labels with parentheses", () => {
            const code = "A[Label (with parens)] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Label (with parens)"] --> B');
        });

        it("should quote labels with curly braces", () => {
            const code = "A[Object {x: 1}] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Object {x: 1}"] --> B');
        });

        it("should quote labels with pipe", () => {
            const code = "A[A | B] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["A | B"] --> B');
        });

        it("should quote labels with equals sign", () => {
            const code = "A[x = 5] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["x = 5"] --> B');
        });

        it("should quote labels with forward slash", () => {
            const code = "A[path/to/file] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["path/to/file"] --> B');
        });

        it("should quote labels with backslash", () => {
            const code = "A[C:\\\\Windows\\\\System] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["C:\\\\Windows\\\\System"] --> B');
        });

        it("should quote labels with colon", () => {
            const code = "A[Time: 12:30] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Time: 12:30"] --> B');
        });

        it("should quote labels with question mark", () => {
            const code = "A[Is valid?] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Is valid?"] --> B');
        });

        it("should quote labels with exclamation mark", () => {
            const code = "A[Alert!] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Alert!"] --> B');
        });

        it("should quote labels with at sign", () => {
            const code = "A[user@email.com] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["user@email.com"] --> B');
        });

        it("should quote labels with percent sign", () => {
            const code = "A[50% complete] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["50% complete"] --> B');
        });

        it("should quote labels with plus sign", () => {
            const code = "A[A + B] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["A + B"] --> B');
        });

        it("should quote labels with asterisk", () => {
            const code = "A[A * B] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["A * B"] --> B');
        });

        it("should quote labels with caret", () => {
            const code = "A[x^2] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["x^2"] --> B');
        });

        it("should quote labels with tilde", () => {
            const code = "A[~approximate] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["~approximate"] --> B');
        });

        it("should quote labels with backticks", () => {
            const code = "A[`code`] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["`code`"] --> B');
        });

        it("should quote labels with single quotes", () => {
            const code = "A[It's working] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["It\'s working"] --> B');
        });
    });

    describe("unicode and special characters", () => {
        it("should quote labels with German umlauts", () => {
            const code = "A[Größe] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Größe"] --> B');
        });

        it("should quote labels with emojis", () => {
            const code = "A[Start 🚀] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Start 🚀"] --> B');
        });

        it("should quote labels with Greek letters", () => {
            const code = "A[Alpha α Beta β] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Alpha α Beta β"] --> B');
        });

        it("should quote labels with math symbols", () => {
            const code = "A[∑ ∫ √ ∞ π] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["∑ ∫ √ ∞ π"] --> B');
        });

        it("should quote labels with currency symbols", () => {
            const code = "A[Price: €50 £30 ¥100] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["Price: €50 £30 ¥100"] --> B');
        });

        it("should quote labels with arrows", () => {
            const code = "A[A → B ← C ↔ D] --> B";
            expect(sanitizeMermaidCode(code)).toBe('A["A → B ← C ↔ D"] --> B');
        });
    });

    describe("different node types", () => {
        it("should sanitize round bracket nodes (stadium shape)", () => {
            const code = "A(Step #1) --> B";
            expect(sanitizeMermaidCode(code)).toBe('A("Step &#35;1") --> B');
        });

        it("should sanitize curly bracket nodes (rhombus)", () => {
            const code = "A{Decision <>?} --> B";
            expect(sanitizeMermaidCode(code)).toBe('A{"Decision &lt;&gt;?"} --> B');
        });
    });

    describe("double quote handling", () => {
        it("should replace double quotes with single quotes", () => {
            const code = 'A[Say "Hello"] --> B';
            expect(sanitizeMermaidCode(code)).toBe("A[\"Say 'Hello'\"] --> B");
        });

        it("should handle already quoted labels and still encode entities", () => {
            // Already quoted labels still get their contents encoded
            const code = 'A["Topic #1"] --> B';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("&#35;"); // # encoded
        });
    });

    describe("HTML tag handling", () => {
        it("should convert <br> to newline", () => {
            const code = "A[Line1<br>Line2] --> B";
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("\\n");
        });

        it("should convert <br/> to newline", () => {
            const code = "A[Line1<br/>Line2] --> B";
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("\\n");
        });

        it("should convert <br /> to newline", () => {
            const code = "A[Line1<br />Line2] --> B";
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("\\n");
        });
    });

    describe("edge labels", () => {
        it("should encode edge label content", () => {
            const code = 'A -->|"+= add; -= sub"| B';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("&#59;"); // ; encoded in edge label
        });
    });

    describe("subgraph labels", () => {
        it("should encode subgraph label content", () => {
            const code = 'subgraph SG["Staging; Prod"]';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("&#59;"); // ; encoded
        });
    });

    describe("user's wild example - comprehensive test", () => {
        it("should handle emojis and special chars together", () => {
            const code = `A["Start 🚀 / 'init' (v1.0)"] --> B`;
            const result = sanitizeMermaidCode(code);
            expect(result).toContain('A["Start 🚀 / \'init\' (v1.0)"]');
        });

        it("should handle URL encode patterns", () => {
            const code = 'D["URL encode: %20 %2F; query=a+b"]';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("&#59;"); // ; encoded
        });

        it("should handle math symbols", () => {
            const code = 'E["Math: ∑ i²  √(x)  3.14≈π  ±∞"]';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("∑");
            expect(result).toContain("π");
            expect(result).toContain("∞");
        });

        it("should handle logic operators with ampersand", () => {
            const code = 'G["Logic: (A ∧ B) && || !"]';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("∧");
            expect(result).toContain("&amp;&amp;"); // && becomes encoded
        });

        it("should handle subgraph with special chars", () => {
            const code = 'subgraph SG["Subgraph: Staging|Prod (canary%)"]';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("subgraph SG");
        });

        it("should handle complex node with hash", () => {
            const code = 'X["Queue::kafka/topic#1 | group=consumer@2"]';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("&#35;"); // # encoded
        });

        it("should handle SQL-like content with semicolons", () => {
            const code = 'Z["DB: table=order-items; col=price€"]';
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("&#59;"); // ; encoded
            expect(result).toContain("€");
        });
    });

    describe("edge cases", () => {
        it("should handle empty labels", () => {
            const code = "A[] --> B";
            expect(sanitizeMermaidCode(code)).toBe("A[] --> B");
        });

        it("should handle multi-line code", () => {
            const code = `flowchart LR
    A[Step #1] --> B[Step #2]
    B --> C{Decision?}`;
            const result = sanitizeMermaidCode(code);
            expect(result).toContain('A["Step &#35;1"]');
            expect(result).toContain('B["Step &#35;2"]');
            expect(result).toContain('C{"Decision?"}');
        });

        it("should preserve mermaid comments", () => {
            const code = `flowchart TB
  %% This is a comment
  A[Node #1] --> B`;
            const result = sanitizeMermaidCode(code);
            expect(result).toContain("%% This is a comment");
            expect(result).toContain('A["Node &#35;1"]');
        });
    });

    describe("complete wild example integration test", () => {
        it("should sanitize the complete wild example diagram", () => {
            const wildExample = `flowchart TB
  %% "Wild" nodes with lots of special characters (keep many labels quoted)

  A["Start 🚀 / 'init' (v1.0)  [α|β]  {x=y}  <tag>  #hash  @me"] -->|"+= add; -= sub; *= mul; /= div"| B["Parse: JSON/YAML/XML?  (a,b,c)  [1..n]  <>&  \\"quotes\\"  'apostrophes'"]

  B --> C["Regex: ^[A-Za-z0-9_\\\\-]+$  /path/to/file  C:\\\\Windows\\\\System32"]
  B -->|"HTTP 200/301/404\\nGET /api/v1/items?id=42&x=y"| D["URL encode: %20 %2F %3F %26  ;  query=a+b"]

  C --> E["Math: ∑(i=1..n) i²  √(x)  f(x)=x^2  3.14≈π  ±∞"]
  D --> F["Escapes: \\\\n \\\\t \\\\r \\\\\\\\  \\"double\\"  'single'  \`backticks\`"]

  E --> G["Logic: (A ∧ B) → ¬C  && || !  true/false  (?:) ternary"]
  F --> G

  %% Subgraph with odd punctuation
  subgraph SG["Subgraph: [Staging|Prod] {blue/green} (canary%)"]
    direction LR
    X["Queue::kafka/topic#1 | group=consumer@2"] --> Y["Worker<id=42> :: handle(event){ return ok; }"]
    Y --> Z["DB: table=\\"order-items\\"; col=\`price€\`; note='äöü ß'"]
  end

  G --> SG

  %% Some styling (may vary by renderer)
  classDef warn fill:#fff3cd,stroke:#856404,stroke-width:2px,color:#533f03;
  classDef danger fill:#f8d7da,stroke:#721c24,stroke-width:2px,color:#721c24;

  A:::warn
  D:::danger`;

            const result = sanitizeMermaidCode(wildExample);

            // Critical checks for problematic characters
            expect(result).not.toContain("#hash"); // # must be encoded
            expect(result).toContain("&#35;hash"); // as &#35;

            expect(result).not.toMatch(/<tag>/); // < and > must be encoded (but not break match)
            expect(result).toContain("&lt;tag&gt;");

            expect(result).toContain("&amp;"); // & must be encoded

            expect(result).toContain("&#59;"); // ; must be encoded

            // Verify structure is preserved
            expect(result).toContain("flowchart TB");
            expect(result).toContain("subgraph SG");
            expect(result).toContain("A:::warn");
            expect(result).toContain("D:::danger");
            expect(result).toContain("%% \"Wild\" nodes");
        });

        it("should encode # in first node correctly", () => {
            const code = `A["#hash"] --> B`;
            const result = sanitizeMermaidCode(code);
            expect(result).toBe(`A["&#35;hash"] --> B`);
        });

        it("should encode < and > in nodes correctly", () => {
            const code = `A["<tag>"] --> B`;
            const result = sanitizeMermaidCode(code);
            expect(result).toBe(`A["&lt;tag&gt;"] --> B`);
        });
    });
});

