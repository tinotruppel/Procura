import { Tool, SchemaType, getActiveTab } from "./types";

/**
 * Gets geolocation by executing in the active tab's context.
 * This allows the permission prompt to show properly.
 */
async function getGeolocationFromTab(): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    heading: number | null;
    speed: number | null;
    timestamp: number;
}> {
    console.log("[Geolocation] Starting getGeolocationFromTab");

    // Get the active tab
    const tab = await getActiveTab();
    console.log("[Geolocation] Active tab:", tab.id, tab.url);

    // Check if we can inject into this tab
    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        throw new Error("Location access not possible on this page. Please open a regular website.");
    }

    console.log("[Geolocation] Executing script in tab...");

    // Execute geolocation request in the tab's context
    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            console.log("[Geolocation:Tab] Script started");
            return new Promise<{
                latitude: number;
                longitude: number;
                accuracy: number;
                altitude: number | null;
                heading: number | null;
                speed: number | null;
                timestamp: number;
            } | { error: string }>((resolve) => {
                if (!navigator.geolocation) {
                    console.log("[Geolocation:Tab] Geolocation not supported");
                    resolve({ error: "Geolocation is not supported by this browser" });
                    return;
                }

                console.log("[Geolocation:Tab] Calling getCurrentPosition...");
                // eslint-disable-next-line sonarjs/no-intrusive-permissions -- core functionality of this tool
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        console.log("[Geolocation:Tab] Got position:", position.coords);
                        resolve({
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                            accuracy: position.coords.accuracy,
                            altitude: position.coords.altitude,
                            heading: position.coords.heading,
                            speed: position.coords.speed,
                            timestamp: position.timestamp,
                        });
                    },
                    (error) => {
                        console.log("[Geolocation:Tab] Error:", error.code, error.message);
                        let message: string;
                        switch (error.code) {
                            case error.PERMISSION_DENIED:
                                message = "Location access was denied. Please allow access in the browser.";
                                break;
                            case error.POSITION_UNAVAILABLE:
                                message = "Location information is unavailable.";
                                break;
                            case error.TIMEOUT:
                                message = "Location request timed out.";
                                break;
                            default:
                                message = "Unknown error during location request.";
                        }
                        resolve({ error: message });
                    },
                    {
                        enableHighAccuracy: false, // false = faster, uses WiFi/IP instead of GPS
                        timeout: 30000, // 30 seconds
                        maximumAge: 300000, // 5 minutes cache
                    }
                );
            });
        },
    });

    console.log("[Geolocation] Script results:", JSON.stringify(results, null, 2));

    if (!results || results.length === 0) {
        throw new Error("Could not execute location script");
    }

    const scriptResult = results[0];
    console.log("[Geolocation] Script result object:", scriptResult);

    // Check for Chrome scripting error
    if ("error" in scriptResult && scriptResult.error) {
        const err = scriptResult.error as { message?: string };
        throw new Error(err.message || "Script execution failed");
    }

    // Get the actual result
    const data = scriptResult.result as { error?: string; latitude?: number; longitude?: number } | undefined;
    console.log("[Geolocation] Result data:", data);

    if (!data) {
        throw new Error("No location data received");
    }

    // Check if the result contains an error
    if ("error" in data && data.error) {
        throw new Error(data.error);
    }

    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") {
        throw new Error("Invalid location data received");
    }

    return data as {
        latitude: number;
        longitude: number;
        accuracy: number;
        altitude: number | null;
        heading: number | null;
        speed: number | null;
        timestamp: number;
    };
}

export const geolocationTool: Tool = {
    name: "geolocation",
    description: "Gets the user's current geographic position.",
    enabledByDefault: true,

    defaultConfig: {},

    schema: {
        name: "geolocation",
        description: "Gets the current geographic position (latitude, longitude) of the user",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                reason: {
                    type: SchemaType.STRING,
                    description: "Optional reason why the location is needed",
                },
            },
            required: [],
        },
    },

    execute: async () => {
        try {
            const position = await getGeolocationFromTab();

            return {
                success: true,
                data: {
                    latitude: position.latitude,
                    longitude: position.longitude,
                    accuracy: `${Math.round(position.accuracy)} m`,
                    altitude: position.altitude !== null
                        ? `${Math.round(position.altitude)} m`
                        : null,
                    heading: position.heading,
                    speed: position.speed !== null
                        ? `${(position.speed * 3.6).toFixed(1)} km/h`
                        : null,
                    timestamp: new Date(position.timestamp).toISOString(),
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Location request failed",
            };
        }
    },
};
