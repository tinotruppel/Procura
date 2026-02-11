import { Tool, SchemaType } from "./types";

export const datetimeTool: Tool = {
    name: "datetime",
    description: "Returns the current date and time including the weekday. Use this when you need to know the current time, date, or day of the week.",
    enabledByDefault: true,

    defaultConfig: {},

    schema: {
        name: "datetime",
        description: "Gets the current date, time, and weekday",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {},
            required: [],
        },
    },

    execute: async () => {
        try {
            const now = new Date();

            // Get weekday names
            const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const weekday = weekdays[now.getDay()];

            // Get month names
            const months = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
            const month = months[now.getMonth()];

            // Format time with leading zeros
            const hours = now.getHours().toString().padStart(2, "0");
            const minutes = now.getMinutes().toString().padStart(2, "0");
            const seconds = now.getSeconds().toString().padStart(2, "0");

            // ISO format for machine processing
            const isoString = now.toISOString();

            // Unix timestamp
            const timestamp = now.getTime();

            // Timezone offset in hours
            const timezoneOffset = -now.getTimezoneOffset() / 60;
            const timezoneString = `UTC${timezoneOffset >= 0 ? "+" : ""}${timezoneOffset}`;

            return {
                success: true,
                data: {
                    weekday,
                    day: now.getDate(),
                    month,
                    monthNumber: now.getMonth() + 1,
                    year: now.getFullYear(),
                    hours: now.getHours(),
                    minutes: now.getMinutes(),
                    seconds: now.getSeconds(),
                    time: `${hours}:${minutes}:${seconds}`,
                    date: `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`,
                    formatted: `${weekday}, ${month} ${now.getDate()}, ${now.getFullYear()} at ${hours}:${minutes}`,
                    iso: isoString,
                    timestamp,
                    timezone: timezoneString,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to get datetime",
            };
        }
    },
};
