import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveSecret, resolveSecrets } from "../../src/lib/vault-resolver";
import * as connection from "../../src/db/connection";
import * as vaultCrypto from "../../src/lib/vault-crypto";

// Mock dependencies
vi.mock("../../src/db/connection", () => ({
    getSecret: vi.fn(),
}));

vi.mock("../../src/lib/vault-crypto", () => ({
    hashApiKey: vi.fn((key: string) => `hash_${key}`),
    decryptSecret: vi.fn(),
}));

describe("vault-resolver", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe("resolveSecret", () => {
        it("should resolve from vault when secret exists and apiKey is provided", async () => {
            const mockRow = {
                ciphertext: Buffer.from("cipher"),
                salt: Buffer.from("salt"),
                iv: Buffer.from("iv"),
                tag: Buffer.from("tag"),
            };
            vi.mocked(connection.getSecret).mockResolvedValue(mockRow as never);
            vi.mocked(vaultCrypto.decryptSecret).mockReturnValue("vault-value");

            const result = await resolveSecret("MY_SECRET", "api-key-123");

            expect(result).toBe("vault-value");
            expect(vaultCrypto.hashApiKey).toHaveBeenCalledWith("api-key-123");
            expect(connection.getSecret).toHaveBeenCalledWith("hash_api-key-123", "MY_SECRET");
            expect(vaultCrypto.decryptSecret).toHaveBeenCalledWith("api-key-123", mockRow);
        });

        it("should fall back to env when vault has no secret", async () => {
            vi.mocked(connection.getSecret).mockResolvedValue(null);
            process.env.MY_SECRET = "env-value";

            const result = await resolveSecret("MY_SECRET", "api-key-123");

            expect(result).toBe("env-value");
        });

        it("should fall back to env when decryption fails", async () => {
            const mockRow = {
                ciphertext: Buffer.from("cipher"),
                salt: Buffer.from("salt"),
                iv: Buffer.from("iv"),
                tag: Buffer.from("tag"),
            };
            vi.mocked(connection.getSecret).mockResolvedValue(mockRow as never);
            vi.mocked(vaultCrypto.decryptSecret).mockImplementation(() => {
                throw new Error("Decryption failed");
            });
            process.env.MY_SECRET = "env-fallback";

            const result = await resolveSecret("MY_SECRET", "api-key-123");

            expect(result).toBe("env-fallback");
        });

        it("should fall back to env when no apiKey is provided", async () => {
            process.env.MY_SECRET = "env-value";

            const result = await resolveSecret("MY_SECRET", undefined);

            expect(result).toBe("env-value");
            expect(connection.getSecret).not.toHaveBeenCalled();
        });

        it("should return undefined when no secret in vault or env", async () => {
            vi.mocked(connection.getSecret).mockResolvedValue(null);
            delete process.env.MY_SECRET;

            const result = await resolveSecret("MY_SECRET", "api-key-123");

            expect(result).toBeUndefined();
        });
    });

    describe("resolveSecrets", () => {
        it("should resolve multiple secrets", async () => {
            vi.mocked(connection.getSecret).mockResolvedValue(null);
            process.env.KEY_A = "val-a";
            process.env.KEY_B = "val-b";

            const result = await resolveSecrets(["KEY_A", "KEY_B"], undefined);

            expect(result).toEqual({ KEY_A: "val-a", KEY_B: "val-b" });
        });

        it("should omit secrets that have no value", async () => {
            vi.mocked(connection.getSecret).mockResolvedValue(null);
            process.env.KEY_A = "val-a";
            delete process.env.KEY_B;

            const result = await resolveSecrets(["KEY_A", "KEY_B"], undefined);

            expect(result).toEqual({ KEY_A: "val-a" });
        });
    });
});
