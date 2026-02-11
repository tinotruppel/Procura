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

function App() {
    const [view, setView] = useState<View>("chat");
    const [deepLinkParams, setDeepLinkParams] = useState<DeepLinkParams | null>(null);
    const [vaultReady, setVaultReady] = useState(false);
    const [vaultUnlocked, setVaultUnlocked] = useState(false);

    // Handle deep link query params on startup (PWA fallback)
    useEffect(() => {
        const url = new URL(window.location.href);
        const promptId = url.searchParams.get("promptId");
        const agentMsg = url.searchParams.get("agentMsg");

        if (promptId || agentMsg) {
            console.log("[PWA] Deep link params detected:", { promptId, agentMsg });
            setDeepLinkParams({ promptId, agentMsg });
            // Clean URL without reload
            window.history.replaceState({}, "", "/");
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
                    onLogout={() => setVaultUnlocked(false)}
                />
            ) : (
                <Settings onBack={() => setView("chat")} />
            )}
        </div>
    );
}

export default App;
