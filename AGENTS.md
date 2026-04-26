# AGENTS.md — Procura AI Coding Guidelines

> **Purpose**: Single source of truth for all AI coding assistants working on this codebase.
> Every rule here is mandatory and takes precedence over general AI behavior.

---

## 1. Project Identity

**Procura** is an AI-powered browser extension & PWA with multi-provider LLM support, tool orchestration, and end-to-end encrypted sync. All source code is AI-generated ("Vibe Coding") — the human maintainer acts as editor, curator, and architect.

- **License**: MIT
- **Version**: Synchronized across `package.json` (root), `frontend/package.json`, `backend/package.json`, and `frontend/public/manifest.json`
- **Repository**: `github.com/tinotruppel/procura`

---

## 2. Architecture Overview

```
procura/
├── frontend/    # Chrome Extension + PWA (React 18, Vite, TailwindCSS 3)
├── backend/     # API & MCP Servers (Hono, MySQL, esbuild)
├── scripts/     # Release, testing, CWS publishing, debugging helpers
└── document/    # Chrome Web Store assets, slides, screenshots
```

### 2.1 Frontend (Chrome Extension + PWA)

| Aspect | Detail |
|--------|--------|
| Framework | React 18 + TypeScript |
| Bundler | Vite 6 (separate configs for Extension and PWA) |
| Styling | TailwindCSS 3 + Radix UI primitives + `class-variance-authority` |
| LLM Providers | Gemini (`@google/generative-ai`), Claude, OpenAI, any OpenAI-compatible |
| Rendering | Mermaid diagrams, Marpit slide decks, `react-markdown` + `remark-gfm` |
| Icons | `lucide-react` |
| Testing | Vitest + React Testing Library + `@testing-library/user-event` |
| Linting | ESLint 9 + `@typescript-eslint` + `sonarjs` + `unicorn` + `import` |
| Duplication | `jscpd` (threshold: 5%) |
| Dead Code | `ts-prune` |
| Security | `semgrep --config p/typescript` |
| Builds | `npm run build:extension` (Chrome), `npm run build:pwa` (PWA) |
| Dev | `npm run dev` (vite build --watch) |

### 2.2 Backend (API + MCP Servers)

| Aspect | Detail |
|--------|--------|
| Framework | Hono 4 + `@hono/node-server` |
| Database | MySQL (production), better-sqlite3 (dev/test) |
| MCP SDK | `@modelcontextprotocol/sdk` + `@hono/mcp` |
| Validation | Zod |
| AI | `@google/genai` (Imagen image generation) |
| Bundler | esbuild (ESM, `--packages=external`) |
| Testing | Vitest |
| Linting | ESLint 9 + `@typescript-eslint` + `sonarjs` |
| Dev | `npm run dev` (SQLite, hot reload via `tsx watch`) |
| Dev (MySQL) | `npm run dev:mysql` |

### 2.3 Platform Abstraction Layer (PAL)

`frontend/src/platform/` abstracts environment-specific APIs behind a unified interface. Chrome Extension APIs (`chrome.storage`, `chrome.tabs`, `chrome.scripting`) and Web/PWA equivalents are swapped at build time.

**Critical**: Always use PAL imports (`@/platform`) for storage, tabs, and notifications — never call `chrome.*` APIs directly from components.

### 2.4 Security Architecture

- **SecurityGate**: App renders `<SecurityGate>` before any content. All downstream components can assume the vault is unlocked.
- **Vault (E2EE)**: PBKDF2 + HKDF key derivation from user's Security Key. AES-256-GCM encryption. Keys never leave the device.
- **BYOK Server Vault**: Server-side secrets encrypted per-user with `X-API-Key`, resolved per-request via `vault-resolver.ts`.
- **API Key Auth**: Backend endpoints protected by configurable API keys (`API_KEYS` env var).
- **Zero-Knowledge Sync**: All synced data encrypted client-side. Server stores opaque blobs only.

---

## 3. MCP Servers (Backend)

13 MCP servers registered in `backend/src/routes/mcp-directory.ts`. When adding a new MCP route, update **both** `index.ts` (route mounting) and `mcp-directory.ts` (registry).

| Server | Endpoint | Powered By |
|--------|----------|------------|
| Tasks | `/mcp/tasks` | Trello (OAuth) |
| Weather | `/mcp/weather` | OpenWeatherMap |
| CV Database | `/mcp/cv-database` | Flowcase |
| Vector Store | `/mcp/vector-store` | Qdrant + OpenAI embeddings |
| Document & Media | `/mcp/document-media` | OpenAI Vision + Whisper |
| GitHub | `/mcp/github` | GitHub API |
| Image Generation | `/mcp/image-generation` | Google Imagen |
| Google Docs | `/mcp/google-docs` | Google Docs API (OAuth) |
| Google Sheets | `/mcp/google-sheets` | Google Sheets API (OAuth) |
| Google Slides | `/mcp/google-slides` | Google Slides API (OAuth) |
| Google Drive | `/mcp/google-drive` | Google Drive API (OAuth) |
| Gmail | `/mcp/gmail` | Gmail API (OAuth) |
| Google Calendar | `/mcp/google-calendar` | Google Calendar API (OAuth) |

### MCP Protocol Rules

- **CORS Headers**: Must include `Mcp-Session-Id`, `MCP-Protocol-Version`, `X-API-Key` (and `X-Api-Key` for browser compatibility).
- **Accept Header**: POST requests need both `application/json` AND `text/event-stream`.
- **Discovery Endpoints**: `/.well-known/*` paths must be excluded from auth middleware (RFC 9728).
- **OAuth AS Isolation**: Mount Authorization Servers at provider-specific prefixes (`/google`, `/trello`).
- **Proxy Bypass**: Client skips proxy for same-origin endpoints to reduce latency.

---

## 4. Browser-Side Tools (Frontend)

Registry-based architecture in `frontend/src/tools/`. Tools self-describe via metadata (`settingsFields`, `connectionTester`, `customAction`).

| Tool | File |
|------|------|
| Calculator | `calculator.ts` |
| Date/Time | `datetime.ts` |
| File Parser | `file-parser.ts` |
| Geolocation | `geolocation.ts` |
| HTTP Requests | `http-request.ts` |
| Langfuse Prompt | `langfuse-prompt.ts` |
| Memory | `memory.ts` |
| Read Page | `read-page.ts` |
| Schedule | `schedule.ts` |
| Screenshot | `screenshot.ts` |
| Web Interaction | `web-interaction.ts` |

**Tool Registration**: `frontend/src/tools/registry.ts` — gathers all native tools and discovers MCP servers at startup.

**Tool Results**: Always return `{ success: boolean, data?, error? }`. Include HTTP status codes and first 500 chars of error body in the `error` string for LLM diagnostics.

---

## 5. Development Rules

### 5.1 Internet Research (MANDATORY)

**Your training data is outdated.** Before using any third-party library, framework, or API:
1. Search the internet for current documentation
2. Read the content of pages found
3. Follow links recursively until you have complete, up-to-date information
4. Never rely solely on training data for package usage

### 5.2 Less is More

Prefer solutions that require less code. Think twice about your approach. If there's a simpler way to achieve the same result, choose that path.

### 5.3 Making Code Changes

- **Always read** the relevant file contents before editing (at least 2000 lines for context)
- **Small, testable, incremental changes** that logically follow from investigation and plan
- If a patch is not applied correctly, attempt to reapply it
- **Work test-driven**: implement tests first → implement feature → run tests → fix tests
- After implementation, run the relevant tests and build the app

### 5.4 Environment Variables

When a project requires an environment variable:
1. Check if `backend/.env.example` exists
2. If not, create it with placeholders for required variables
3. Inform the user proactively

### 5.5 Backend/Frontend Alignment

- Do **not** add frontend features that are not supported by the backend
- Remove legacy or deprecated flows instead of keeping backward compatibility

### 5.6 Codebase Hygiene

- Remove unused exports and dead code (don't keep unused APIs for tests)
- Keep documentation aligned with current capabilities
- Components exceeding 1,000 lines should be audited for decomposition

---

## 6. Code Quality Standards

### 6.1 Language

All comments, tests, error messages, logs, and documentation are written in **English**.

### 6.2 Logging

- Use `createLogger("tag")` from `backend/src/lib/logger.ts` instead of raw `console.log/error`
- Use appropriate levels: `error`, `warn`, `info`, `debug` (filtered via `LOG_LEVEL` env var)
- Log incoming requests with identifiers (masked API keys) for traceability

### 6.3 Security Patterns

| Rule | Pattern |
|------|---------|
| Log Forgery | Use separate arguments: `console.warn("Error in", name, err)` — not template literals |
| Random Generation | Use `crypto.randomUUID()` or `crypto.getRandomValues()` — never `Math.random()` for IDs/tokens |
| RegExp Safety | Use strict allow-lists to prevent ReDoS. Prefer `.test()` over `.match()` |
| Logical Clarity | Object lookups for static mappings, `== undefined` for loose null/undefined checks |
| Extension Permissions | Request only what is strictly necessary. Prune unused permissions routinely |

### 6.4 TypeScript

- All code is TypeScript (strict mode)
- Use Zod for runtime validation (backend config, API inputs)
- Prefer `type` over `interface` only when unions/intersections are needed
- Narrow types explicitly in tests: `(result.data as { timerId: string }).timerId`

---

## 7. Testing

### 7.1 Framework & Coverage

- **Framework**: Vitest (both frontend and backend)
- **Coverage Target**: ≥80% for core logic
- **Duplication Target**: <5% (enforced by `jscpd`)

### 7.2 Full Test Suite

Run the complete quality pipeline:

```bash
bash scripts/test-all.sh
```

This executes (in order):
1. Frontend tests + coverage (`vitest run --coverage`)
2. Backend tests + coverage (`vitest run --coverage`)
3. Frontend ESLint
4. Backend ESLint
5. Semgrep SAST (if installed)
6. npm audit (frontend + backend)
7. Frontend build (`build:extension`)
8. Backend build (`esbuild`)

### 7.3 When the User Says "test"

1. Run `bash scripts/test-all.sh`
2. Fix any issues found
3. Implement additional tests if coverage is below 80%
4. Search for duplicated code and refactor
5. Run ESLint and fix errors/warnings
6. Run Semgrep and fix findings
7. Run `npm audit` and fix issues
8. Build the application to verify no build errors

### 7.4 Testing Patterns

- **PAL Mocking**: Mock `@/platform` to simulate Extension vs. Web environments
- **Chrome API**: Use `vi.stubGlobal("chrome", mockObject)` for tabs, scripting, identity
- **Hoisting**: Use `vi.hoisted` for variables needed in `vi.mock` factories
- **Fetch**: Mock responses must include `ok` property (e.g., `{ ok: true, status: 200 }`)
- **Crypto**: Create fresh `Uint8Array` copies for `crypto.subtle` inputs in JSDOM
- **UI**: Use loose regex locators (`/Text/i`) for resilient assertions
- **Timers**: Use `vi.useFakeTimers()` for schedule/timer logic
- **Async**: Wrap async state updates in `await act(...)` or use `waitFor`

---

## 8. Git & Release Process

### 8.1 Git Rules

- **NEVER** stage, commit, or push automatically. Only do so when the user explicitly asks.
- When the user says "commit": run `git diff`, commit with an English message, and push.
- Work on the `develop` branch for all development.

### 8.2 Release Workflow

1. Ensure all changes are on `develop` branch
2. **Update `CHANGELOG.md`** with new version section (Added, Changed, Fixed, Removed) — **mandatory**
3. Commit the CHANGELOG update on `develop`
4. Merge into `main`: `git checkout main && git merge develop`
5. Run `bash scripts/release.sh X.Y.Z` — this:
   - Bumps versions in all `package.json` files + `manifest.json`
   - Commits and creates a git tag `vX.Y.Z`
   - Builds the Chrome Extension and creates a zip
   - Pushes to origin and creates a GitHub Release
6. Sync branches: `git checkout develop && git reset --hard main && git push origin develop --force-with-lease`
7. Stay on `develop` for continued work

### 8.3 Chrome Web Store Publishing

Optional: `bash scripts/release.sh X.Y.Z --cws` triggers `scripts/cws-publish.sh` for CWS upload.

---

## 9. Key Files & Directory Reference

### Root

| File | Purpose |
|------|---------|
| `package.json` | Root scripts: `test`, `lint`, `release`, workspace commands |
| `scripts/test-all.sh` | Full quality pipeline |
| `scripts/release.sh` | Automated release workflow |
| `scripts/cws-publish.sh` | Chrome Web Store publishing |
| `CHANGELOG.md` | Release history (must be updated before every release) |

### Backend (`backend/`)

| File/Dir | Purpose |
|----------|---------|
| `src/index.ts` | Main entry: Hono app, middleware, route mounting |
| `src/config.ts` | Zod-validated config from environment variables |
| `src/routes/` | All route handlers (sync, vault, MCP servers, OAuth) |
| `src/routes/mcp-directory.ts` | MCP server registry (must stay in sync with index.ts) |
| `src/middleware/` | CORS, auth, rate limiting, request logging |
| `src/db/` | Database connection pool (MySQL/SQLite) |
| `src/lib/` | Shared utilities (logger, vault-crypto, vault-resolver) |
| `.env.example` | Template for environment variables |

### Frontend (`frontend/`)

| File/Dir | Purpose |
|----------|---------|
| `src/App.tsx` | Root component: vault gate, deep links, share target, view routing |
| `src/components/` | UI components (Chat, Settings, MCP, Sync, Vault, Mermaid, Marpit) |
| `src/lib/` | Core libraries (LLM providers, MCP client, vault, sync, storage) |
| `src/tools/` | Browser-side tool implementations + registry |
| `src/platform/` | PAL: Chrome Extension vs. Web environment abstraction |
| `src/hooks/` | React hooks |
| `src/types/` | Shared TypeScript types |
| `src/content/` | Chrome Extension content scripts |
| `src/background.ts` | Chrome Extension background/service worker |
| `src/service-worker.ts` | PWA service worker |
| `vite.config.ts` | Vite config (Extension build) |
| `vite.config.pwa.ts` | Vite config (PWA build) |

---

## 10. Environment Setup

### Backend
```bash
cd backend
npm install
cp .env.example .env    # Configure credentials
mysql -u root < schema.sql
npm run dev              # SQLite dev mode (no MySQL needed)
npm run dev:mysql        # MySQL dev mode
```

### Frontend
```bash
cd frontend
npm install
npm run dev              # Extension build with watch
npm run build:extension  # Production Chrome Extension
npm run build:pwa        # Production PWA
```

### Required Environment Variables (Backend)

See `backend/.env.example` for the full list. Key variables:

| Variable | Used By |
|----------|---------|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection |
| `API_KEYS` | Backend auth (comma-separated) |
| `OPENAI_API_KEY` | Vector Store embeddings, Document/Media OCR & transcription |
| `GEMINI_API_KEY` | Image Generation |
| `OPENWEATHERMAP_API_KEY` | Weather MCP |
| `TRELLO_APP_KEY` | Tasks MCP (OAuth) |
| `FLOWCASE_API_KEY` | CV Database MCP |
| `QDRANT_URL`, `QDRANT_API_KEY` | Vector Store MCP |
| `GITHUB_TOKEN` | GitHub MCP |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Workspace MCPs (OAuth) |
| `TOKEN_ENCRYPTION_KEY` | OAuth token encryption (64 hex chars) |

---

## 11. Adding a New MCP Server (Checklist)

1. Create `backend/src/routes/<name>-mcp.ts` following existing patterns (use `@hono/mcp` + `@modelcontextprotocol/sdk`)
2. Add entry to `MCP_SERVERS` array in `backend/src/routes/mcp-directory.ts`
3. Import and mount route in `backend/src/index.ts` (with auth middleware)
4. Add required env vars to `backend/.env.example`
5. Write tests in `backend/src/routes/<name>-mcp.test.ts`
6. Update this AGENTS.md (Section 3: MCP Servers)

## 12. Adding a New Browser Tool (Checklist)

1. Create `frontend/src/tools/<name>.ts` implementing the tool interface from `types.ts`
2. Register in `frontend/src/tools/index.ts`
3. Add `settingsFields` / `connectionTester` / `customAction` as needed
4. Write tests in `frontend/src/tools/<name>.test.ts`
5. Update this AGENTS.md (Section 4: Browser-Side Tools)
