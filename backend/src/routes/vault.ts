/**
 * Vault Routes
 *
 * Manages server-side encrypted secrets (BYOK — Bring Your Own Key).
 * The client's API Key (from X-API-Key header) serves as the encryption
 * master key. Secrets are encrypted with AES-256-GCM before storage
 * and can only be decrypted with the same API Key.
 *
 *   GET    /vault/secrets       — List secret names + timestamps (never values)
 *   PUT    /vault/secrets       — Store/overwrite one or more secrets
 *   DELETE /vault/secrets/:name — Delete a single secret
 */

import { Hono } from "hono";
import { hashApiKey, encryptSecret } from "../lib/vault-crypto";
import { listSecrets, upsertSecret, deleteSecret } from "../db/connection";

export const vaultRoutes = new Hono();

/**
 * GET /vault/secrets
 * Returns metadata only — never the actual secret values.
 */
vaultRoutes.get("/secrets", async (c) => {
    const apiKey = c.req.header("X-API-Key") || "";
    if (!apiKey) return c.json({ error: "API key required" }, 401);

    const keyId = hashApiKey(apiKey);
    const rows = await listSecrets(keyId);

    return c.json({
        secrets: rows.map(r => ({
            name: r.name,
            set: true,
            updatedAt: r.updated_at,
        })),
    });
});

/**
 * PUT /vault/secrets
 * Body: { "SECRET_NAME": "plaintext_value", ... }
 * Encrypts each value with the client's API Key and stores the ciphertext.
 */
vaultRoutes.put("/secrets", async (c) => {
    const apiKey = c.req.header("X-API-Key") || "";
    if (!apiKey) return c.json({ error: "API key required" }, 401);

    const body = await c.req.json<Record<string, string>>();
    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
        return c.json({ error: "Body must be a non-empty object of { name: value } pairs" }, 400);
    }

    const keyId = hashApiKey(apiKey);
    const stored: string[] = [];

    for (const [name, value] of Object.entries(body)) {
        if (typeof value !== "string") continue;
        const encrypted = encryptSecret(apiKey, value);
        await upsertSecret(keyId, name, encrypted.salt, encrypted.iv, encrypted.tag, encrypted.ciphertext);
        stored.push(name);
    }

    return c.json({ stored });
});

/**
 * DELETE /vault/secrets/:name
 * Deletes a single secret by name.
 */
vaultRoutes.delete("/secrets/:name", async (c) => {
    const apiKey = c.req.header("X-API-Key") || "";
    if (!apiKey) return c.json({ error: "API key required" }, 401);

    const name = c.req.param("name");
    const keyId = hashApiKey(apiKey);
    const deleted = await deleteSecret(keyId, name);

    if (!deleted) {
        return c.json({ error: "Secret not found" }, 404);
    }

    return c.json({ deleted: true });
});
