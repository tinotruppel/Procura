/**
 * Weather MCP Server
 * Implements the Model Context Protocol for weather operations
 * 
 * Endpoint: /mcp/weather
 * Transport: Streamable HTTP via @hono/mcp
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { resolveSecret } from "../lib/vault-resolver";

const OPENWEATHER_API_BASE = "https://api.openweathermap.org";

// =============================================================================
// Types
// =============================================================================

interface WeatherAuth {
    apiKey: string;
    units: string;
}

interface GeocodingResult {
    lat: number;
    lon: number;
    name: string;
    country: string;
}

interface CurrentWeather {
    temp: number;
    feels_like: number;
    humidity: number;
    pressure: number;
    wind_speed: number;
    weather: Array<{ main: string; description: string }>;
    clouds: number;
    visibility: number;
}

interface DailyForecast {
    dt: number;
    temp: { min: number; max: number };
    weather: Array<{ main: string; description: string }>;
    humidity: number;
    wind_speed: number;
    pop: number;
}

interface OneCallResponse {
    current: CurrentWeather;
    daily?: DailyForecast[];
}

// =============================================================================
// Weather API Helpers
// =============================================================================

async function geocodeCity(city: string, apiKey: string): Promise<GeocodingResult> {
    const url = `${OPENWEATHER_API_BASE}/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
    }

    const data = await response.json() as Array<{ lat: number; lon: number; name: string; country: string }>;
    if (!data || data.length === 0) {
        throw new Error(`City "${city}" not found`);
    }

    return {
        lat: data[0].lat,
        lon: data[0].lon,
        name: data[0].name,
        country: data[0].country,
    };
}

async function fetchWeather(
    lat: number,
    lon: number,
    apiKey: string,
    units: string,
    includeForecast: boolean
): Promise<OneCallResponse> {
    const exclude = includeForecast
        ? "minutely,hourly,alerts"
        : "minutely,hourly,daily,alerts";

    const url = `${OPENWEATHER_API_BASE}/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=${exclude}&units=${units}&lang=de&appid=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("Invalid OpenWeatherMap API key");
        }
        throw new Error(`Weather request failed: ${response.status}`);
    }

    return response.json() as Promise<OneCallResponse>;
}

function formatWeatherResult(
    weather: OneCallResponse,
    locationName: string,
    locationCountry: string,
    units: string,
    forecastDays: number
) {
    const unitSymbol = units === "metric" ? "°C" : "°F";
    const speedUnit = units === "metric" ? "m/s" : "mph";

    const result: {
        location: { name: string; country: string };
        current: {
            temperature: string;
            feels_like: string;
            weather: string;
            humidity: string;
            wind_speed: string;
            pressure: string;
            clouds: string;
            visibility: string;
        };
        forecast?: Array<{
            date: string;
            temp_range: string;
            weather: string;
            humidity: string;
            wind_speed: string;
            precipitation_chance: string;
        }>;
    } = {
        location: { name: locationName, country: locationCountry },
        current: {
            temperature: `${weather.current.temp}${unitSymbol}`,
            feels_like: `${weather.current.feels_like}${unitSymbol}`,
            weather: weather.current.weather[0].description,
            humidity: `${weather.current.humidity}%`,
            wind_speed: `${weather.current.wind_speed} ${speedUnit}`,
            pressure: `${weather.current.pressure} hPa`,
            clouds: `${weather.current.clouds}%`,
            visibility: `${weather.current.visibility / 1000} km`,
        },
    };

    if (forecastDays > 0 && weather.daily) {
        result.forecast = weather.daily.slice(0, forecastDays).map(day => ({
            date: new Date(day.dt * 1000).toLocaleDateString("de-DE", {
                weekday: "short",
                day: "numeric",
                month: "short",
            }),
            temp_range: `${day.temp.min}${unitSymbol} - ${day.temp.max}${unitSymbol}`,
            weather: day.weather[0].description,
            humidity: `${day.humidity}%`,
            wind_speed: `${day.wind_speed} ${speedUnit}`,
            precipitation_chance: `${Math.round(day.pop * 100)}%`,
        }));
    }

    return result;
}

// =============================================================================
// MCP Server Setup
// =============================================================================

// Request-scoped API key (set per-request in the route handler)
let currentRequestApiKey: string | undefined;

/**
 * Resolve weather auth from vault (per-request) or process.env (fallback).
 */
async function resolveAuth(): Promise<WeatherAuth | null> {
    const apiKey = await resolveSecret("OPENWEATHERMAP_API_KEY", currentRequestApiKey);
    if (!apiKey) return null;

    const units = await resolveSecret("OPENWEATHERMAP_UNITS", currentRequestApiKey);
    return { apiKey, units: units || "metric" };
}

// Create MCP server instance — tools are always registered
const mcpServer = new McpServer({
    name: "weather",
    version: "1.0.0",
});

// --- get_weather ---
mcpServer.registerTool(
    "get_weather",
    {
        description: "Get current weather and optionally a multi-day forecast for a city or coordinates",
        inputSchema: {
            city: z.string().optional().describe("Name of the city (e.g. 'Berlin', 'Munich'). Use this OR latitude/longitude, not both."),
            latitude: z.number().optional().describe("Latitude coordinate (e.g. 52.52). Use together with longitude instead of city name."),
            longitude: z.number().optional().describe("Longitude coordinate (e.g. 13.405). Use together with latitude instead of city name."),
            forecast_days: z.number().optional().describe("Number of days to forecast (1-8). If not provided, only current weather is returned."),
        },
    },
    async ({ city, latitude, longitude, forecast_days }) => {
        const auth = await resolveAuth();
        if (!auth) {
            return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: "OPENWEATHERMAP_API_KEY not configured. Store it via vault or set as environment variable." }, null, 2) }],
                isError: true
            };
        }

        const forecastDays = Math.min(8, Math.max(0, forecast_days || 0));

        let lat: number;
        let lon: number;
        let locationName: string;
        let locationCountry: string;

        if (latitude !== undefined && longitude !== undefined) {
            lat = latitude;
            lon = longitude;
            locationName = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
            locationCountry = "Coordinates";
        } else if (city) {
            const location = await geocodeCity(city, auth.apiKey);
            lat = location.lat;
            lon = location.lon;
            locationName = location.name;
            locationCountry = location.country;
        } else {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        error: "Either 'city' or both 'latitude' and 'longitude' must be provided."
                    }, null, 2)
                }],
                isError: true
            };
        }

        const weather = await fetchWeather(
            lat,
            lon,
            auth.apiKey,
            auth.units,
            forecastDays > 0
        );

        const result = formatWeatherResult(
            weather,
            locationName,
            locationCountry,
            auth.units,
            forecastDays
        );

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify(result, null, 2)
            }]
        };
    }
);

// --- geocode_city ---
mcpServer.registerTool(
    "geocode_city",
    {
        description: "Convert a city name to geographic coordinates",
        inputSchema: {
            city: z.string().describe("Name of the city to geocode"),
        },
    },
    async ({ city }) => {
        const auth = await resolveAuth();
        if (!auth) {
            return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: "OPENWEATHERMAP_API_KEY not configured." }, null, 2) }],
                isError: true
            };
        }
        const location = await geocodeCity(city, auth.apiKey);
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    city: location.name,
                    country: location.country,
                    latitude: location.lat,
                    longitude: location.lon,
                }, null, 2)
            }]
        };
    }
);

// =============================================================================
// HTTP Routes with Hono MCP Transport
// =============================================================================

export const weatherMcpRoutes = new Hono();

const transport = new StreamableHTTPTransport();

/**
 * MCP endpoint - handles all MCP communication.
 * Sets the request-scoped API key for vault secret resolution.
 */
weatherMcpRoutes.all("/", async (c) => {
    // Set request-scoped API key for vault resolution
    currentRequestApiKey = c.req.header("X-API-Key") || undefined;

    try {
        if (!mcpServer.isConnected()) {
            await mcpServer.connect(transport);
        }

        return transport.handleRequest(c);
    } catch (e) {
        console.error("[weather-mcp] Error handling request:", e);
        return c.json({ error: "Internal server error" }, 500);
    }
});

/**
 * Health/info endpoint
 */
weatherMcpRoutes.get("/info", async (c) => {
    const requestApiKey = c.req.header("X-API-Key") || undefined;
    currentRequestApiKey = requestApiKey;
    const auth = await resolveAuth();
    return c.json({
        name: "weather",
        version: "1.0.0",
        status: auth ? "ready" : "not_configured",
        configured: !!auth,
        tools: ["get_weather", "geocode_city"],
        units: auth?.units || "metric",
        note: auth ? undefined : "Store OPENWEATHERMAP_API_KEY in vault or set as environment variable"
    });
});
