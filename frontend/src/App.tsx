import { useState, useEffect } from "react";
import { Chat } from "@/components/Chat";
import { Settings } from "@/components/Settings";
import { SecurityGate } from "@/components/SecurityGate";
import { isVaultUnlocked, restoreVaultFromSession } from "@/lib/vault";
import { getTheme, applyTheme } from "@/lib/storage";

type View = "chat" | "settings";

interface DeepLinkParams {
    promptId: string | null;
    agentMsg: string | null;
}

export interface SharedFileInfo {
    name: string;
    type: string;
    size: number;
    cacheKey: string;
}

function App() {
    const [view, setView] = useState<View>("chat");
    const [deepLinkParams, setDeepLinkParams] = useState<DeepLinkParams | null>(null);
    const [initialInput, setInitialInput] = useState<string>("");
    const [sharedFiles, setSharedFiles] = useState<SharedFileInfo[]>([]);
    const [vaultReady, setVaultReady] = useState(false);
    const [vaultUnlocked, setVaultUnlocked] = useState(false);

    // Handle deep link and share target params on startup
    useEffect(() => {
        const urlObj = new URL(window.location.href);
        const isShareTarget = urlObj.searchParams.has("share-target");

        if (isShareTarget) {
            // POST-based share target: read from service worker cache
            console.log("[PWA] Web Share Target (POST) detected, reading from cache...");
            window.history.replaceState({}, "", "/");

            (async () => {
                try {
                    const cache = await caches.open("share-target-cache");

                    // Read text fields
                    const textResponse = await cache.match(new Request("/_share-target/text"));
                    if (textResponse) {
                        const textData = await textResponse.json();
                        const parts: string[] = [];
                        if (textData.title && textData.title !== textData.text) parts.push(textData.title);
                        if (textData.text) parts.push(textData.text);
                        if (textData.url && textData.url !== textData.text && textData.url !== textData.title) parts.push(textData.url);
                        if (parts.length > 0) setInitialInput(parts.join("\n\n"));
                    }

                    // Read file manifest
                    const manifestResponse = await cache.match(new Request("/_share-target/manifest"));
                    if (manifestResponse) {
                        const fileList: SharedFileInfo[] = await manifestResponse.json();
                        if (fileList.length > 0) {
                            console.log(`[PWA] Share target: ${fileList.length} file(s) received`);
                            setSharedFiles(fileList);
                        }
                    }
                } catch (err) {
                    console.error("[PWA] Failed to read share target cache:", err);
                }
            })();
        } else {
            // Standard deep link params
            const promptId = urlObj.searchParams.get("promptId");
            const agentMsg = urlObj.searchParams.get("agentMsg");
            if (promptId || agentMsg) {
                console.log("[PWA] Deep link params detected:", { promptId, agentMsg });
                setDeepLinkParams({ promptId, agentMsg });
                window.history.replaceState({}, "", "/");
            }
        }
    }, []);

    useEffect(() => {
        async function initVault() {
            // Initialize theme first to prevent flash
            const theme = await getTheme();
            applyTheme(theme);

            await restoreVaultFromSession();
            setVaultUnlocked(isVaultUnlocked());
            setVaultReady(true);
        }
        initVault();
    }, []);

    if (!vaultReady) {
        return <div className="h-dvh w-full bg-background" />;
    }

    if (!vaultUnlocked) {
        return <SecurityGate onUnlocked={() => setVaultUnlocked(true)} />;
    }

    return (
        <div className="h-dvh w-full bg-background overflow-hidden" style={{ height: '100dvh' }}>
            {view === "chat" ? (
                <Chat
                    onOpenSettings={() => setView("settings")}
                    deepLinkParams={deepLinkParams}
                    initialInput={initialInput}
                    sharedFiles={sharedFiles}
                    onLogout={() => setVaultUnlocked(false)}
                />
            ) : (
                <Settings onBack={() => setView("chat")} />
            )}
        </div>
    );
}

export default App;
