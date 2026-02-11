import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";

// ============================================================================
// System Prompts Collection
// ============================================================================

export interface SystemPrompt {
    id: string;
    title: string;
    prompt: string;
}

function generatePromptId(): string {
    return crypto.randomUUID();
}

export async function getSystemPrompts(): Promise<SystemPrompt[]> {
    const prompts = await storage.getValueOrDefault<SystemPrompt[]>(STORAGE_KEYS.SYSTEM_PROMPTS, []);
    // Sort alphabetically by title
    return prompts.sort((a, b) => a.title.localeCompare(b.title));
}

export async function setSystemPrompts(prompts: SystemPrompt[]): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.SYSTEM_PROMPTS]: prompts,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

export async function addSystemPrompt(title: string, prompt: string): Promise<SystemPrompt> {
    const prompts = await getSystemPrompts();
    const newPrompt: SystemPrompt = {
        id: generatePromptId(),
        title,
        prompt,
    };
    prompts.push(newPrompt);
    await setSystemPrompts(prompts);
    return newPrompt;
}

export async function updateSystemPrompt(id: string, title: string, prompt: string): Promise<void> {
    const prompts = await getSystemPrompts();
    const index = prompts.findIndex(p => p.id === id);
    if (index !== -1) {
        prompts[index] = { id, title, prompt };
        await setSystemPrompts(prompts);
    }
}

export async function deleteSystemPrompt(id: string): Promise<void> {
    const prompts = await getSystemPrompts();
    const filtered = prompts.filter(p => p.id !== id);
    await setSystemPrompts(filtered);
    // Clear selection if deleted prompt was selected
    const selectedId = await getSelectedSystemPromptId();
    if (selectedId === id) {
        await setSelectedSystemPromptId(null);
    }
}

export async function getSelectedSystemPromptId(): Promise<string | null> {
    return storage.getValueOrDefault<string | null>(STORAGE_KEYS.SELECTED_PROMPT_ID, null);
}

export async function setSelectedSystemPromptId(id: string | null): Promise<void> {
    if (id === null) {
        await storage.remove(STORAGE_KEYS.SELECTED_PROMPT_ID);
    } else {
        await storage.set({ [STORAGE_KEYS.SELECTED_PROMPT_ID]: id });
    }
    await storage.set({ [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now() });
}

/**
 * Get the active system prompt text based on current selection
 * Returns empty string if no prompt selected or prompt not found
 */
export async function getActiveSystemPrompt(): Promise<string> {
    const selectedId = await getSelectedSystemPromptId();
    if (!selectedId) return "";

    const prompts = await getSystemPrompts();
    const prompt = prompts.find(p => p.id === selectedId);
    return prompt?.prompt || "";
}
