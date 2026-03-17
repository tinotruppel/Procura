# Procura Backend

TypeScript/Hono backend providing the Procura sync API, MCP proxy, and **7 cloud MCP tool servers**.

## Requirements

- Node.js 20+
- MySQL 8.0+

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create configuration:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. Create database table:
   ```bash
   mysql -u root < schema.sql
   ```

## Development

```bash
# Start with hot reload
npm run dev:node

# Type check
npm run typecheck

# Run tests
npx vitest run

# Lint
npx eslint src/
```

## Production

```bash
npm run build
npm start
```

## Architecture

```
src/
├── index.ts              # App entry, route mounting, health check
├── config.ts             # Zod-validated env config
├── db/connection.ts      # MySQL connection pool
├── middleware/
│   ├── auth.ts           # API key authentication
│   ├── cors.ts           # CORS configuration
│   └── rate-limit.ts     # In-memory rate limiter
└── routes/
    ├── sync.ts           # E2EE settings & chat sync
    ├── mcp-proxy.ts      # CORS bypass for external MCP servers
    ├── mcp-directory.ts  # Cloud MCP server directory
    ├── tasks-mcp.ts      # Trello-backed task management
    ├── weather-mcp.ts    # OpenWeatherMap integration
    ├── cv-database-mcp.ts       # Flowcase CV search
    ├── vector-store-mcp.ts      # Qdrant semantic search / vector store
    ├── document-media-mcp.ts    # OCR & audio transcription
    ├── github-mcp.ts            # GitHub API (read + limited write)
    └── image-generation-mcp.ts  # Google Imagen AI
```

## API Endpoints

### Core

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with DB status and service listing |
| GET | `/sync/:userId` | List all synced objects with timestamps |
| GET | `/sync/:userId/:objectId` | Get single synced object |
| PUT | `/sync/:userId/:objectId` | Store encrypted object |
| POST | `/mcp-proxy` | Forward requests to external MCP servers (CORS bypass) |
| GET | `/mcp-directory` | List available cloud MCP servers |

### MCP Tool Servers

All MCP servers are accessible via SSE transport at their respective endpoints. They require API key authentication.

#### Tasks (`/mcp/tasks`) — Trello Integration

| Tool | Description |
|------|-------------|
| `list_projects` | List available Trello boards |
| `list_statuses` | Get status columns in a board |
| `list_labels` | Get labels in a board |
| `list_tickets` | Get all tickets with statuses |
| `create_ticket` | Create a new ticket |
| `get_ticket` | Get ticket details |
| `update_ticket` | Update title, description, status, labels, due date |
| `archive_ticket` | Archive (close) a ticket |
| `get_comments` | Get comments on a ticket |
| `add_comment` | Add a comment |
| `get_attachments` | List attachments |
| `add_attachment` | Add attachment (URL or base64) |
| `get_attachment` | Get attachment details with download |

#### Weather (`/mcp/weather`) — OpenWeatherMap

| Tool | Description |
|------|-------------|
| `get_weather` | Current weather + multi-day forecast for a city or coordinates |
| `geocode` | Convert city name to geographic coordinates |

#### CV Database (`/mcp/cv-database`) — Flowcase

| Tool | Description |
|------|-------------|
| `search_people` | Search people by name |
| `search_content` | Semantic search for skills, technologies, or experience |
| `get_cv` | Get full CV details for a person |

#### Vector Store (`/mcp/vector-store`) — Qdrant + OpenAI Embeddings

| Tool | Description |
|------|-------------|
| `list_collections` | View available collections |
| `create_collection` | Create new vector collections automatically sized correctly |
| `archive` | Chunk documents and store embeddings |
| `search` | Semantic search with auto-embeddings |
| `retrieve` | Fetch specific points |

#### Document & Media (`/mcp/document-media`) — OpenAI Whisper + Vision

| Tool | Description |
|------|-------------|
| `transcribe_audio` | Speech-to-text from audio files (mp3, wav, m4a, webm) |
| `parse_file` | OCR for PDFs and images, with optional Q&A |

#### GitHub (`/mcp/github`) — GitHub API

| Tool | Description |
|------|-------------|
| `list_projects` | List repositories for a user/org |
| `get_project` | Get repository details |
| `list_issues` | List issues (excluding PRs by default) |
| `get_issue` | Get issue details |
| `list_pull_requests` | List pull requests |
| `get_pull_request` | Get PR details |
| `list_files` | List files/directories in a path |
| `get_file` | Get file contents |
| `list_gists` | List gists |
| `get_gist` | Get gist details |
| `create_gist` | Create a new gist |
| `list_workflows` | List GitHub Actions workflows |
| `get_workflow` | Get workflow details |
| `list_workflow_runs` | List workflow runs |
| `trigger_workflow` | Trigger a workflow dispatch |
| `cancel_workflow_run` | Cancel a running workflow |
| `search_code` | Search code within a repository |

#### Image Generation (`/mcp/image-generation`) — Google Imagen AI

| Tool | Description |
|------|-------------|
| `generate_image` | Generate an image from a text prompt |

## Middleware

- **Authentication**: API key validation via `API_KEYS` env var (comma-separated). Empty = open mode.
- **CORS**: Configurable origin via `CORS_ORIGIN`.
- **Rate Limiting**: In-memory sliding window. Configurable via `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW`.

## Environment Variables

See `.env.example` for all available options.

### Required

| Variable | Description |
|----------|-------------|
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port (default: 3306) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |

### MCP Server Credentials

| Variable | Used By | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | Knowledge Base, Document/Media | OpenAI API key for embeddings and Whisper |
| `GEMINI_API_KEY` | Image Generation | Google Gemini/Imagen API key |
| `OPENWEATHERMAP_API_KEY` | Weather | OpenWeatherMap API key |
| `TRELLO_API_KEY` | Tasks | Trello API key |
| `TRELLO_TOKEN` | Tasks | Trello OAuth token |
| `FLOWCASE_API_KEY` | CV Database | Flowcase API key |
| `QDRANT_URL` | Knowledge Base | Qdrant cluster URL |
| `QDRANT_API_KEY` | Knowledge Base | Qdrant API key |
| `QDRANT_EMBEDDING_MODEL` | Knowledge Base | OpenAI embedding model (default: `text-embedding-3-small`) |
| `GITHUB_TOKEN` | GitHub | GitHub personal access token |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `RATE_LIMIT_REQUESTS` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | `60` | Window in seconds |
| `MAX_BLOB_SIZE` | `52428800` | Max sync blob size (50MB) |
| `API_KEYS` | _(empty)_ | Comma-separated API keys |
| `MCP_PROXY_ALLOWED_DOMAINS` | _(empty)_ | Allowed proxy domains |
