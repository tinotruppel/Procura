import { Tool, SchemaType } from "./types";

// Factorial helper
function factorial(n: number): number {
    if (n < 0) throw new Error("Factorial of negative number");
    if (n > 170) throw new Error("Factorial too large");
    if (!Number.isInteger(n)) throw new Error("Factorial requires integer");
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

// Supported Math functions
const MATH_FUNCTIONS: { [key: string]: (...args: number[]) => number } = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    ceil: Math.ceil,
    floor: Math.floor,
    round: Math.round,
    trunc: Math.trunc,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2, // atan2(y, x) - angle in radians
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    log: Math.log,
    log10: Math.log10,
    log2: Math.log2,
    exp: Math.exp,
    pow: Math.pow,
    min: Math.min,
    max: Math.max,
    factorial: factorial,
    fact: factorial, // Alias
};

const CONSTANTS: { [key: string]: number } = {
    PI: Math.PI,
    E: Math.E,
};

/**
 * Tokenizer for mathematical expressions
 */
function tokenize(expr: string): string[] {
    const tokens: string[] = [];
    let i = 0;

    while (i < expr.length) {
        const char = expr[i];

        // Skip whitespace
        if (/\s/.test(char)) {
            i++;
            continue;
        }

        // Numbers (including decimals)
        if (/\d/.test(char) || (char === '.' && /\d/.test(expr[i + 1] || ''))) {
            let num = '';
            while (i < expr.length && /[\d.]/.test(expr[i])) {
                num += expr[i++];
            }
            tokens.push(num);
            continue;
        }

        // Identifiers (function names, constants)
        if (/[a-zA-Z_]/.test(char)) {
            let id = '';
            while (i < expr.length && /\w/.test(expr[i])) {
                id += expr[i++];
            }
            tokens.push(id);
            continue;
        }

        // Operators (handle ** as single token)
        if (char === '*' && expr[i + 1] === '*') {
            tokens.push('**');
            i += 2;
            continue;
        }

        // Single character operators and parentheses
        if ('+-*/()^,'.includes(char)) {
            tokens.push(char);
            i++;
            continue;
        }

        // Normalize unicode
        if ('×⋅∙·'.includes(char)) { tokens.push('*'); i++; continue; }
        if (char === '÷') { tokens.push('/'); i++; continue; }
        if ('−–—'.includes(char)) { tokens.push('-'); i++; continue; }
        if (char === '√') { tokens.push('sqrt'); i++; continue; }

        throw new Error(`Unknown character: ${char}`);
    }

    return tokens;
}

/**
 * Recursive descent parser for math expressions
 * Handles: numbers, +, -, *, /, ** (power), ^, parentheses, functions, constants
 */
class ExpressionParser {
    private tokens: string[];
    private pos: number = 0;

    constructor(tokens: string[]) {
        this.tokens = tokens;
    }

    parse(): number {
        const result = this.parseExpression();
        if (this.pos < this.tokens.length) {
            throw new Error(`Unexpected token: ${this.tokens[this.pos]}`);
        }
        return result;
    }

    private peek(): string | undefined {
        return this.tokens[this.pos];
    }

    private consume(): string {
        return this.tokens[this.pos++];
    }

    // Expression = Term (('+' | '-') Term)*
    private parseExpression(): number {
        let left = this.parseTerm();

        while (this.peek() === '+' || this.peek() === '-') {
            const op = this.consume();
            const right = this.parseTerm();
            left = op === '+' ? left + right : left - right;
        }

        return left;
    }

    // Term = Power (('*' | '/') Power)*
    private parseTerm(): number {
        let left = this.parsePower();

        while (this.peek() === '*' || this.peek() === '/') {
            const op = this.consume();
            const right = this.parsePower();
            left = op === '*' ? left * right : left / right;
        }

        return left;
    }

    // Power = Unary (('**' | '^') Power)?  (right associative)
    private parsePower(): number {
        let base = this.parseUnary();

        if (this.peek() === '**' || this.peek() === '^') {
            this.consume();
            const exp = this.parsePower(); // Right associative
            base = Math.pow(base, exp);
        }

        return base;
    }

    // Unary = '-' Unary | '+' Unary | Primary
    private parseUnary(): number {
        if (this.peek() === '-') {
            this.consume();
            return -this.parseUnary();
        }
        if (this.peek() === '+') {
            this.consume();
            return this.parseUnary();
        }
        return this.parsePrimary();
    }

    // Primary = Number | '(' Expression ')' | Function '(' Args ')' | Constant
    private parsePrimary(): number {
        const token = this.peek();

        if (!token) {
            throw new Error("Unexpected end of expression");
        }

        // Number
        if (/^\d/.test(token) || (token.startsWith('.') && token.length > 1)) {
            this.consume();
            const num = parseFloat(token);
            if (isNaN(num)) throw new Error(`Invalid number: ${token}`);
            return num;
        }

        // Parentheses
        if (token === '(') {
            this.consume();
            const result = this.parseExpression();
            if (this.peek() !== ')') {
                throw new Error("Missing closing parenthesis");
            }
            this.consume();
            return result;
        }

        // Function or constant
        if (/^[a-zA-Z_]/.test(token)) {
            this.consume();
            const tokenLower = token.toLowerCase();
            const tokenUpper = token.toUpperCase();

            // Check if it's a constant
            if (tokenUpper in CONSTANTS) {
                return CONSTANTS[tokenUpper];
            }

            // Must be a function - expect '('
            if (this.peek() !== '(') {
                throw new Error(`Unknown identifier: ${token}`);
            }
            this.consume(); // '('

            // Parse arguments
            const args: number[] = [];
            if (this.peek() !== ')') {
                args.push(this.parseExpression());
                while (this.peek() === ',') {
                    this.consume();
                    args.push(this.parseExpression());
                }
            }

            if (this.peek() !== ')') {
                throw new Error("Missing closing parenthesis for function");
            }
            this.consume(); // ')'

            // Look up function
            const fn = MATH_FUNCTIONS[tokenLower];
            if (!fn) {
                throw new Error(`Unknown function: ${token}`);
            }

            return fn(...args);
        }

        throw new Error(`Unexpected token: ${token}`);
    }
}

/**
 * Safely evaluates a mathematical expression using a custom parser.
 * No eval() or new Function() - CSP safe!
 */
function evaluateExpression(expr: string): number {
    // Remove thousand separators (1,000 -> 1000) but preserve function argument commas
    // Only remove commas that are NOT inside parentheses and are surrounded by digits
    let cleaned = "";
    let parenDepth = 0;
    for (let i = 0; i < expr.length; i++) {
        const char = expr[i];
        if (char === "(") {
            parenDepth++;
            cleaned += char;
        } else if (char === ")") {
            parenDepth--;
            cleaned += char;
        } else if (char === "," && parenDepth === 0) {
            // Outside parens: check if it's a thousand separator (digits on both sides)
            const prev = expr[i - 1];
            const next = expr[i + 1];
            if (prev && next && /\d/.test(prev) && /\d/.test(next)) {
                // Skip the comma (thousand separator)
                continue;
            }
            cleaned += char;
        } else {
            cleaned += char;
        }
    }

    const tokens = tokenize(cleaned);
    const parser = new ExpressionParser(tokens);
    const result = parser.parse();

    if (!isFinite(result)) {
        throw new Error("Invalid result");
    }

    return result;
}

// Export for testing
export { tokenize, evaluateExpression, MATH_FUNCTIONS, CONSTANTS };

export const calculatorTool: Tool = {
    name: "calculator",
    description: `Performs mathematical calculations. Supports:
- Basic arithmetic: +, -, *, /, ** (power), ^ (power)
- Functions: ${Object.keys(MATH_FUNCTIONS).join(", ")}
- Constants: PI, E
Examples: "sqrt(16)", "2**10", "sin(PI/2)", "log10(1000)"`,
    enabledByDefault: true,

    defaultConfig: {
        maxPrecision: 10,
    },

    settingsFields: [
        { key: "maxPrecision", label: "Max. Decimal Places", type: "text", placeholder: "10" },
    ],


    schema: {
        name: "calculator",
        description: `Calculates mathematical expressions. Supports basic arithmetic (+, -, *, /), exponentiation (** or ^), and functions like sqrt(), sin(), cos(), log(), pow(), abs(), etc. Examples: "25 * 4", "sqrt(144)", "2**8", "sin(PI/2)"`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                expression: {
                    type: SchemaType.STRING,
                    description: "The mathematical expression, e.g. '25 * 4', 'sqrt(144)', '2**10', 'sin(PI/2)'",
                },
            },
            required: ["expression"],
        },
    },

    execute: async (args, config) => {
        try {
            const expression = args.expression as string;
            const maxPrecision = (config.maxPrecision as number) ?? 10;
            const result = evaluateExpression(expression);

            // Apply precision
            const rounded = Number(result.toFixed(maxPrecision));

            return {
                success: true,
                data: {
                    expression,
                    result: rounded,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Calculation failed",
            };
        }
    },
};
