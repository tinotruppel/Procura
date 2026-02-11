import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type GoogleAuthModule = typeof import("./google-auth");
let getGoogleAccessToken: GoogleAuthModule["getGoogleAccessToken"];
let createAuthHeaders: GoogleAuthModule["createAuthHeaders"];
let ScopeSets: GoogleAuthModule["ScopeSets"];

// Will be set per test
let mockIsExtension = vi.fn(() => true);

// Mock @/platform
vi.mock("@/platform", () => ({
    isExtension: () => mockIsExtension(),
    isWeb: () => !mockIsExtension(),
}));

// Mock chrome.identity API
const mockLaunchWebAuthFlow = vi.fn();
const mockGetRedirectURL = vi.fn(() => "https://abcdefgh.chromiumapp.org/");
vi.stubGlobal("chrome", {
    identity: {
        launchWebAuthFlow: mockLaunchWebAuthFlow,
        getRedirectURL: mockGetRedirectURL,
    },
});

// Mock window.open for popup tests
const mockPopup = {
    closed: false,
    close: vi.fn(),
};
const mockWindowOpen = vi.fn(() => mockPopup);
vi.stubGlobal("open", mockWindowOpen);

describe("google-auth", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mockPopup.closed = false;
        mockIsExtension = vi.fn(() => true);

        // Mock successful extension OAuth
        mockLaunchWebAuthFlow.mockResolvedValue(
            "https://abcdefgh.chromiumapp.org/#access_token=ext-token&expires_in=3600"
        );

        vi.resetModules();
        const module = await import("./google-auth");
        getGoogleAccessToken = module.getGoogleAccessToken;
        createAuthHeaders = module.createAuthHeaders;
        ScopeSets = module.ScopeSets;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("createAuthHeaders", () => {
        it("should create proper authorization headers", () => {
            const headers = createAuthHeaders("my-token");
            expect(headers.Authorization).toBe("Bearer my-token");
            expect(headers["Content-Type"]).toBe("application/json");
        });
    });

    describe("getGoogleAccessToken - Extension mode", () => {
        beforeEach(() => {
            mockIsExtension = vi.fn(() => true);
        });

        it("should use chrome.identity.launchWebAuthFlow in extension mode", async () => {
            const token = await getGoogleAccessToken("test-client-id", ScopeSets.DOCS);

            expect(mockLaunchWebAuthFlow).toHaveBeenCalled();
            expect(token).toBe("ext-token");
        });

        it("should build correct auth URL with scopes", async () => {
            await getGoogleAccessToken("my-client-id", ["scope1", "scope2"]);

            const authUrl = mockLaunchWebAuthFlow.mock.calls[0][0].url;
            expect(authUrl).toContain("client_id=my-client-id");
            expect(authUrl).toContain("scope1");
            expect(authUrl).toContain("scope2");
        });

        it("should cache token and reuse on subsequent calls", async () => {
            await getGoogleAccessToken("client-id", ScopeSets.DOCS);
            await getGoogleAccessToken("client-id", ScopeSets.DOCS);

            expect(mockLaunchWebAuthFlow).toHaveBeenCalledTimes(1);
        });

        it("should request new token if scopes differ", async () => {
            await getGoogleAccessToken("client-id", ScopeSets.DOCS);
            await getGoogleAccessToken("client-id", ScopeSets.SHEETS);

            expect(mockLaunchWebAuthFlow).toHaveBeenCalledTimes(2);
        });

        it("should throw error when no token in response", async () => {
            mockLaunchWebAuthFlow.mockResolvedValue("https://example.com/#error=access_denied");

            await expect(getGoogleAccessToken("client-id", ["scope"]))
                .rejects.toThrow("No access token");
        });

        it("should throw error when auth flow fails", async () => {
            mockLaunchWebAuthFlow.mockRejectedValue(new Error("User cancelled"));

            await expect(getGoogleAccessToken("client-id", ["scope"]))
                .rejects.toThrow("auth token");
        });
    });

    describe("getGoogleAccessToken - PWA/Web mode (popup)", () => {
        beforeEach(() => {
            mockIsExtension = vi.fn(() => false);
            mockPopup.closed = false;
            // Reset window.open mock to return valid popup
            mockWindowOpen.mockReturnValue(mockPopup);
        });

        it("should open popup window in web mode", async () => {
            // Simulate successful OAuth via postMessage
            const tokenPromise = getGoogleAccessToken("test-client-id", ScopeSets.DOCS);

            // Simulate message from popup
            setTimeout(() => {
                window.dispatchEvent(new MessageEvent("message", {
                    origin: window.location.origin,
                    data: {
                        type: "GOOGLE_OAUTH_SUCCESS",
                        accessToken: "popup-token",
                        expiresIn: 3600,
                    },
                }));
            }, 10);

            const token = await tokenPromise;
            expect(token).toBe("popup-token");
            expect(mockWindowOpen).toHaveBeenCalled();
        });

        it("should build correct popup URL", async () => {
            const tokenPromise = getGoogleAccessToken("my-client", ["scope-a", "scope-b"]);

            setTimeout(() => {
                window.dispatchEvent(new MessageEvent("message", {
                    origin: window.location.origin,
                    data: { type: "GOOGLE_OAUTH_SUCCESS", accessToken: "t", expiresIn: 3600 },
                }));
            }, 10);

            await tokenPromise;

            expect(mockWindowOpen).toHaveBeenCalled();
            const popupUrl = (mockWindowOpen as unknown as { mock: { calls: Array<Array<unknown>> } })
                .mock.calls[0]?.[0] as string;
            expect(popupUrl).toContain("client_id=my-client");
            expect(popupUrl).toContain("oauth-callback.html");
        });

        it("should reject if popup is blocked", async () => {
            mockWindowOpen.mockReturnValue(null as unknown as typeof mockPopup);

            await expect(getGoogleAccessToken("client-id", ["scope"]))
                .rejects.toThrow("Popup");
        });

        it("should reject on OAuth error message", async () => {
            const tokenPromise = getGoogleAccessToken("client-id", ["scope"]);

            setTimeout(() => {
                window.dispatchEvent(new MessageEvent("message", {
                    origin: window.location.origin,
                    data: {
                        type: "GOOGLE_OAUTH_ERROR",
                        error: "Access denied",
                    },
                }));
            }, 10);

            await expect(tokenPromise).rejects.toThrow("Access denied");
        });

        it("should reject if popup is closed without completing", async () => {
            vi.useFakeTimers();

            try {
                const tokenPromise = getGoogleAccessToken("client-id", ["scope"]);
                const rejection = expect(tokenPromise).rejects.toThrow("Authentication cancelled");

                // Simulate popup being closed
                mockPopup.closed = true;

                // Advance timer to trigger poll check
                await vi.advanceTimersByTimeAsync(600);

                await rejection;
            } finally {
                vi.useRealTimers();
            }
        });

        it("should ignore messages from different origins", async () => {
            const tokenPromise = getGoogleAccessToken("client-id", ["scope"]);

            // Send message from wrong origin
            setTimeout(() => {
                window.dispatchEvent(new MessageEvent("message", {
                    origin: "https://evil.com",
                    data: { type: "GOOGLE_OAUTH_SUCCESS", accessToken: "evil", expiresIn: 3600 },
                }));
            }, 5);

            // Send correct message
            setTimeout(() => {
                window.dispatchEvent(new MessageEvent("message", {
                    origin: window.location.origin,
                    data: { type: "GOOGLE_OAUTH_SUCCESS", accessToken: "good", expiresIn: 3600 },
                }));
            }, 15);

            const token = await tokenPromise;
            expect(token).toBe("good");
        });

        it("should cache token in popup mode", async () => {
            const tokenPromise1 = getGoogleAccessToken("client-id", ["scope"]);
            setTimeout(() => {
                window.dispatchEvent(new MessageEvent("message", {
                    origin: window.location.origin,
                    data: { type: "GOOGLE_OAUTH_SUCCESS", accessToken: "cached-token", expiresIn: 3600 },
                }));
            }, 10);
            await tokenPromise1;

            // Second call should use cache
            const token2 = await getGoogleAccessToken("client-id", ["scope"]);
            expect(token2).toBe("cached-token");
            expect(mockWindowOpen).toHaveBeenCalledTimes(1);
        });
    });
});
