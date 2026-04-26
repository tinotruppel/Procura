/**
 * MCP Lazy Auth Helper
 *
 * Allows tool discovery (initialize, tools/list) without OAuth session,
 * while still requiring authentication for tool execution (tools/call).
 *
 * Community best practice: "Lazy Auth" — the LLM agent can discover tools
 * upfront; the user authenticates only when a tool is actually invoked.
 */

/**
 * JSON-RPC methods that are safe to expose without an OAuth session.
 * These methods only return server metadata and tool schemas — no user data.
 */
const DISCOVERY_METHODS = new Set([
    "initialize",
    "notifications/initialized",
    "tools/list",
]);

/**
 * Check if a JSON-RPC method is a discovery method (safe without auth).
 */
export function isDiscoveryMethod(method: string | null | undefined): boolean {
    return method != null && DISCOVERY_METHODS.has(method);
}

/**
 * Extract the JSON-RPC method from a Hono request body.
 *
 * Only works for POST requests with a JSON body. Returns null for
 * non-POST requests (GET/DELETE used for SSE streams and session termination).
 *
 * IMPORTANT: This clones the request body so the original stream remains
 * available for downstream handlers (StreamableHTTPTransport).
 */
export async function getMcpMethod(
    req: { method: string; raw: Request }
): Promise<string | null> {
    if (req.method !== "POST") return null;

    try {
        // Clone the request to avoid consuming the body stream
        const cloned = req.raw.clone();
        const body = await cloned.json() as Record<string, unknown>;
        return typeof body?.method === "string" ? body.method : null;
    } catch {
        return null;
    }
}
