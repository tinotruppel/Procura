# Procura Plugin

AI-powered Chrome Extension for productivity tasks with multi-provider LLM support and built-in plus MCP-based tools.

## Features

- **Multi-Provider LLM Support**: Gemini, Claude, OpenAI, Custom (OpenAI-Compatible)
- **Tools (Built-in + MCP)**: Browser-side tools are built in, while external integrations are provided by MCP servers via backend MCP routes
- **Mermaid Diagrams**: Render diagrams directly in chat messages
- **Marpit Presentations**: Create slide decks using Marpit markdown syntax
- **MCP Protocol**: Connect to external MCP servers
- **Langfuse Integration**: Observability and remote prompts
- **Chat History**: Automatic session management with cleanup

---

## Capabilities

### Chat & Writing
- Answer questions, explain concepts, summarize content
- Write and edit texts (German/English/other languages)
- Structure content (lists, plans), brainstorming

### Browser & Context Tools
| Tool | Description |
|------|-------------|
| **Read Active Tab** | Extract text content from current page |
| **Annotate Page** | Find clickable elements, get URLs |
| **Click/Type** | Interact with browser elements |
| **Screenshot** | Capture and analyze screenshots |

### Files & Documents
| Tool | Description |
|------|-------------|
| **File Parser** | Parse JSON, CSV, Markdown, code files |
| **PDF/Image OCR** | Extract content, answer questions |
| **Audio Transcription** | Transcribe audio files |

### Google Workspace
| Tool | Description |
|------|-------------|
| **Google Docs** | List, read, create, append, replace, rename |
| **Google Sheets** | List, read/write, append rows, create sheets |

### Tasks & Project Tickets
| Tool | Description |
|------|-------------|
| **Projects** | List projects, statuses, labels |
| **Tickets** | Create, update, archive tickets |
| **Comments** | Read and create comments/attachments |

### Knowledge & News
| Tool | Description |
|------|-------------|
| **Search** | Search collections, retrieve documents |
| **Archive** | Store content in archive collection |

### CV/Profile Search
| Tool | Description |
|------|-------------|
| **Person Search** | Find by name |
| **Content Search** | Search skills and content |
| **CV Loader** | Load complete CVs |

### GitHub Integration
| Tool | Description |
|------|-------------|
| **Repository** | Read repos, files, issues, PRs, workflows |
| **Code Search** | Search code across repositories |

### Utilities
| Tool | Description |
|------|-------------|
| **Calculator** | Mathematical calculations |
| **Date/Time** | Current date and time |
| **Geolocation** | Current location |
| **Weather** | Current weather and forecast |
| **HTTP Requests** | Call external APIs |

### Visualization
- **Mermaid Diagrams**: Flowcharts, sequences, XY charts, etc.
- **Marpit Slides**: Create presentation decks with `marpit` code blocks

---

## Installation

```bash
# Install dependencies
npm install

# Development build with watch
npm run dev

# Production build
npm run build

# Run tests
npm run test

# Run tests with coverage
npm run test -- --coverage
```

Load the `dist/` folder as unpacked extension in Chrome.

---

## Configuration

### AI Provider Settings

| Setting | Description |
|---------|-------------|
| **Provider** | Active LLM provider (Gemini, Claude, OpenAI, Custom) |
| **API Key** | Provider-specific API key |
| **Model** | Model to use for the selected provider |
| **Base URL** | Custom provider only: OpenAI-compatible API endpoint |

### Tool Settings

Tools can be built-in or provided by MCP servers. MCP tools are managed via Settings → MCP Servers, then enabled or disabled and configured in the tool list.

### Langfuse Integration

| Setting | Description |
|---------|-------------|
| `enabled` | Enable/disable Langfuse |
| `host` | Langfuse host URL |
| `publicKey` | Langfuse public key |
| `secretKey` | Langfuse secret key |

### Debug Mode

Enable debug mode to see LLM calls, tool executions, and timing info in the console.

---

## Tools Reference

### Tools (Built-in + MCP)

Browser-side tools are built into the extension (e.g. `calculator`, `web_interaction` for the active page, `geolocation`, `screenshot`). External integrations are provided by MCP servers (backend routes like `weather-mcp` and `tasks-mcp`). The frontend lists whatever tools the MCP server exposes, and tool availability depends on those servers.

### Tool Interface

All tools implement the `Tool` interface:

```typescript
interface Tool {
    name: string;
    description: string;
    enabledByDefault: boolean;
    defaultConfig: Record<string, unknown>;
    schema: FunctionDeclaration;
    execute: (args, config) => Promise<ToolExecutionResult>;
}
```

---

## Architecture

### Directory Structure

```
src/
├── components/          # React UI components
│   ├── Chat.tsx         # Main chat interface
│   ├── Settings.tsx     # Settings panel
│   └── ui/              # Shadcn UI components
├── content/
│   └── screenshot-content.ts  # Content script for screenshots
├── lib/                 # Core libraries
│   ├── chat/llm-flow.ts # LLM flow wrapper
│   ├── gemini.ts        # Gemini API client
│   ├── claude.ts        # Claude API client
│   ├── openai.ts        # OpenAI API client
│   ├── storage.ts       # Chrome storage management
│   ├── langfuse.ts      # Langfuse integration
│   ├── image-store.ts   # Image reference system
│   ├── file-store.ts    # Binary file reference system
│   ├── custom-openai.ts # Custom OpenAI-compatible provider
│   ├── mcp-client.ts    # MCP protocol client
│   └── mcp-oauth.ts     # MCP OAuth flows
├── tools/               # Tool interfaces and helpers
│   ├── index.ts         # Tool registry
│   ├── registry.ts      # Dynamic tool registration
│   ├── types.ts         # Tool type definitions
│   └── [tool].ts        # Individual tools
├── App.tsx              # Root component
├── background.ts        # Service worker
└── sidepanel.tsx        # Sidepanel entry
```

### Key Modules

#### `lib/storage.ts`

Chrome storage management with auto-cleanup:

```typescript
// Chat sessions (max 20, auto-cleanup by updatedAt)
await saveCurrentChat(messages, title);
await getChatSessions();
await switchToChat(chatId);

// Config export/import
const config = await exportConfig();
await importConfig(config);

// Debug storage usage
await debugStorageUsage();  // Also: window.debugStorageUsage()
```

#### `lib/image-store.ts`

Prevents LLM hallucination of binary data by using image references:

```typescript
// Add image, get reference ID
const imageRef = addImage(base64DataUrl);  // Returns "img_a3f8b2c1"

// Retrieve image by reference
const dataUrl = getImage(imageRef);
```

#### `lib/chat/llm-flow.ts`

LLM flow wrapper used by the chat UI:

```typescript
const response = await executeLlmChatTurn({
    provider,
    apiKey,
    model,
    messages,
    systemPrompt,
    onDebugEvent,
    onTextChunk,
    signal,
    customBaseUrl,
});
```

---

## Mermaid Diagrams

The AI can output Mermaid diagrams in code blocks, which are rendered as SVG:

```
graph LR
    A[User] --> B[Agent]
    B --> C[Tool]
```

Supported diagram types:
- Flowcharts (`graph`, `flowchart`)
- Sequence diagrams
- Class diagrams
- State diagrams
- XY Charts (`xychart`)
- And more (see [Mermaid docs](https://mermaid.js.org/))

---

## Storage Limits

Chrome extension storage is limited to **10MB**. The plugin auto-cleans:

- **Chat sessions**: Max 20 (oldest by `updatedAt` deleted)
- **Images**: In-memory only, not persisted

### Debug Storage

```javascript
// In browser console
debugStorageUsage()
```

Shows usage by key with visual bars.

---

## Development

### Adding a New Tool

Tools are exposed via MCP servers. Add or extend tools in the backend MCP routes, then register the MCP server in Settings → MCP Servers.

### Testing

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- src/tools/registry.test.ts

# Run with coverage
npm run test -- --coverage
```

### Manual Testing

Use the following prompt to test rendering and tool integration.

```markdown
You are my assistant. Run a comprehensive capabilities test in ONE response (use Markdown).

1) Start with a brief "System Check" section that states what you can/can't access in this environment (tools, browser context, files, etc.) based on what you detect right now.

2) Memory Tool Test (write + read):
- Write a memory entry with:
  key: "mega_test_last_run_note"
  value: "Mega test prompt executed successfully. Timestamp: <current timestamp>"
- Then read back that same memory key and display the returned value.

3) Quick Math:
- Calculate: (37 * 19) / 5 + sqrt(144) and show the working steps.

4) Tasks/Todos:
- Retrieve my current todos using the app's task system (tasks assigned to me OR unassigned; due today/tomorrow OR no due date; exclude Done).
- Present them as a table: Title | Due | Assignee | Status.
- Then create a new task in the default project called "Default Board" titled:
  "Test task: verify automation"
  Description: "Created by the mega test prompt. If you see this, tools work."
  Due: tomorrow.

5) Tech & AI News:
- Pull the most relevant items from the knowledge base collection named "tech-news".
- Rank by how frequently topics appear in the retrieved data (frequency = relevance).
- Summarize top 5 items with: headline, 1-2 sentence summary, and why it matters.

6) Mermaid Visualization:
- Create a Mermaid diagram that visualizes a workflow of this prompt (checks, memory, math, tasks, news, browsing, tab reading, weather, docs, sheets, github, CV, file parsing, image, marpit, http, schedule).
- Keep it simple but correct.

7) Forced Web Navigation + Visual Check (no preconditions):
- Open a new browser tab and navigate to "https://example.com".
- Then take a screenshot of the current tab and summarize what you see (headline, any visible links, layout).
- List 2 possible next actions you could take on that page.

8) Active Tab Reading:
- Read the content of the currently active tab (should still be example.com from step 7).
- Summarize the extracted text content in 2-3 sentences.

9) Date/Time + Location + Weather:
- Tell me today's date/time and weekday.
- Get current weather for Berlin and include a 2-day forecast.
- Summarize it in 3 bullet points.

10) Forced Google Doc Creation + Write (no preconditions):
- Create a NEW Google Doc titled: "Mega Test Prompt - Tooling Check".
- Open/navigate to that newly created doc in the browser.
- Read back the document content to confirm access.
- Append a section titled "Mega Test Prompt Results" with:
  - a timestamp,
  - a 5-bullet summary of what you did in this run,
  - and a short checklist with [ ] boxes.

11) Google Sheets Test:
- Create a NEW Google Sheet titled: "Mega Test - Data Sheet".
- Write the following data starting at A1:
  | Tool | Calls | Status |
  | calculator | 67 | ok |
  | get_weather | 203 | ok |
  | search | 178 | ok |
- Read back the sheet content to confirm it was written correctly.

12) GitHub App Help:
- Read and summarize the file:
  tinotruppel / procura / frontend/README.md
- Give me a short "How to use this app" section.

13) CV Database:
- Search the CV database for profiles with: "Kubernetes AND platform engineering AND Berlin".
- Return the top matches with name + 3 key skills each.

14) File Parser Test:
- Parse the file at: tinotruppel / procura / prototypes/frontend/test/sample-data.json
- Extract and display: the title, total number of top tools, the highest-rated feedback comment, and the average response time metric.

15) Image Generation:
- Generate a small icon image: "A minimalist cloud icon with a lightning bolt, flat design, blue and yellow on white background".
- Display the generated image inline.

16) Marpit Presentation:
- Create a 3-slide Marpit presentation using a marpit code block:
  - Slide 1: Title "Mega Test Results" with today's date
  - Slide 2: A bullet list of 5 key findings from this test run
  - Slide 3: "Thank you" slide with a summary status (X/19 tests passed)

17) HTTP Request Test:
- Make a GET request to "https://httpbin.org/get".
- Display the returned "origin" (IP) and "url" fields from the JSON response.

18) Schedule Tool Test (short delay):
- Schedule a message to be sent to me after 5 seconds.
- The message should be: "Mega test schedule fired: if you see this, schedule works."
- In the final "Test Coverage" section, note that the scheduled message will arrive shortly and should trigger a follow-up response.

19) Optional file analysis:
- If I have uploaded any document in this chat, automatically analyze it and extract key points + any action items.

End with a "Test Coverage" checklist of which sections succeeded/failed and why (X/19).
```

---

## Deep Links

Open the extension with a specific agent and pre-filled message via URL links. Useful for email campaigns, documentation, or integrations.

### URL Schema

```
https://your-domain.com/?promptId=<agent>&agentMsg=<message>
```

| Parameter | Description |
|-----------|-------------|
| `promptId` | Langfuse prompt name (e.g., `Default Agent`) |
| `agentMsg` | Optional initial agent message (triggers LLM continuation) |

### Example Links

**German-English Translations:**
```
https://your-domain.com/?promptId=German-English%20Translations&agentMsg=Guten%20Tag%2C%20wie%20geht%20es%20Ihnen%20heute%3F
```

**Spell Checker:**
```
https://your-domain.com/?promptId=Spell%20Checker&agentMsg=This%20sentence%20has%20some%20speling%20errors%20that%20need%20corecting
```

**Default Agent:**
```
https://your-domain.com/?promptId=Default%20Agent&agentMsg=How%20will%20the%20weather%20be%20tomorrow%3F
```

### How It Works

1. User clicks link in email/website
2. Content script intercepts click (prevents navigation)
3. Background script stores params and opens side panel
4. Chat component reads params, selects prompt, injects agent message
5. LLM triggers continuation based on agent message

---

## MCP Protocol

Connect to external MCP servers for additional tools:

1. Go to Settings → MCP Servers
2. Add server URL
3. Authenticate if required (OAuth or API key)
4. Enable/disable specific tools

Supported auth methods:
- None (public servers)
- API Key
- OAuth 2.0 (PKCE flow)

---

## Langfuse Integration

### Setup

1. Enable in Settings → Langfuse Integration
2. Enter public/secret keys from Langfuse dashboard
3. Click "Test Connection"

### Features

- **Remote Prompts**: Fetch system prompts from Langfuse
- **Tracing**: All LLM calls are traced
- **Variables**: Define `{{variable}}` placeholders

### Prompt Variables

Define values for placeholders in Settings → Prompt Variables:

| Key | Value |
|-----|-------|
| `user_name` | John |
| `company` | Acme Inc |

---

## Export/Import

Settings can be exported as JSON:

- Provider & API keys
- Models
- Tool configurations
- System prompts
- MCP servers
- Langfuse config
- Debug mode

Use the download/upload buttons in Settings header.

---

## License

MIT
