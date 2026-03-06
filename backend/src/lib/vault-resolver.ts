/**
 * Vault Secret Resolver
 *
 * Resolves config values from vault secrets (per-request, per-user)
 * with fallback to process.env. This allows MCP routes to read
 * secrets from the BYOK vault while keeping backward compatibility
 * with environment variable configuration.
 */

import { getSecret } from "../db/connection";
import { hashApiKey, decryptSecret } from "./vault-crypto";
import { createLogger } from "./logger";

const log = createLogger("vault");

/**
 * Resolve a secret value. Check order:
 * 1. Vault (encrypted, per-user) — if apiKey is provided
 * 2. process.env fallback
 */
export async function resolveSecret(
    name: string,
    apiKey: string | undefined,
): Promise<string | undefined> {
    // Try vault first (if apiKey is available)
    if (apiKey) {
        const keyId = hashApiKey(apiKey);
        const row = await getSecret(keyId, name);
        if (row) {
            try {
                const value = decryptSecret(apiKey, {
                    ciphertext: row.ciphertext,
                    salt: row.salt,
                    iv: row.iv,
                    tag: row.tag,
                });
                log.debug(`resolved "${name}" from vault`);
                return value;
            } catch {
                log.warn(`failed to decrypt "${name}"`);
            }
        }
    }

    // Fallback to environment variable
    const envValue = process.env[name];
    if (envValue) {
        log.debug(`resolved "${name}" from env`);
    }
    return envValue;
}

/**
 * Resolve multiple secrets at once. Returns a record of name → value.
 * Only includes secrets that have a value (vault or env).
 */
export async function resolveSecrets(
    names: string[],
    apiKey: string | undefined,
): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const name of names) {
        const value = await resolveSecret(name, apiKey);
        if (value) {
            result[name] = value;
        }
    }
    return result;
}
