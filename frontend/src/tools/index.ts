import { Tool } from "./types";
import { calculatorTool } from "./calculator";
import { screenshotTool } from "./screenshot";
import { httpRequestTool } from "./http-request";
import { geolocationTool } from "./geolocation";
import { datetimeTool } from "./datetime";
import { fileParserTool } from "./file-parser";
import { googleDocsTool } from "./google-docs";
import { googleSheetsTool } from "./google-sheets";
import { memoryTool } from "./memory";
import { readPageTool } from "./read-page";
import { annotatePageTool, clickElementTool, typeTextTool, navigateToTool } from "./web-interaction";
import { scheduleTool, cancelScheduleTool } from "./schedule";

/**
 * All registered tools
 */
export const allTools: Tool[] = [
    calculatorTool,
    screenshotTool,
    httpRequestTool,
    geolocationTool,
    datetimeTool,
    fileParserTool,
    googleDocsTool,
    googleSheetsTool,
    memoryTool,
    readPageTool,
    annotatePageTool,
    clickElementTool,
    typeTextTool,
    navigateToTool,
    scheduleTool,
    cancelScheduleTool,
];

/**
 * Get a tool by name
 */
export function getTool(name: string): Tool | undefined {
    return allTools.find((t) => t.name === name);
}

// Re-export types
export * from "./types";
export { calculatorTool } from "./calculator";
export { screenshotTool } from "./screenshot";
export { httpRequestTool } from "./http-request";
export { geolocationTool } from "./geolocation";
export { datetimeTool } from "./datetime";
export { fileParserTool } from "./file-parser";
export { googleDocsTool } from "./google-docs";
export { googleSheetsTool } from "./google-sheets";
export { memoryTool } from "./memory";
export { readPageTool } from "./read-page";
export { annotatePageTool, clickElementTool, typeTextTool, navigateToTool } from "./web-interaction";
export { scheduleTool, cancelScheduleTool } from "./schedule";
