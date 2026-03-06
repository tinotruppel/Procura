# Procura

**AI-powered browser extension & PWA with multi-provider LLM support, tool orchestration, and end-to-end encrypted sync.**

Procura turns your browser into an AI workspace. Available as a Chrome Extension and a Progressive Web App (PWA), it lets you chat with multiple LLM providers, use built-in browser tools, connect external services via MCP, and sync everything securely across devices.

---

## ✨ Highlights

- **Multi-Provider LLM** — Gemini, Claude, OpenAI, or any OpenAI-compatible endpoint
- **Built-in Browser Tools** — Read pages, click elements, take screenshots, parse files
- **MCP Tool Servers** — Tasks, weather, knowledge base, CV search, GitHub, image generation, and more
- **End-to-End Encrypted Sync** — Settings and chat history sync across devices with zero-knowledge encryption
- **Mermaid & Marpit** — Render diagrams and slide decks directly in chat
- **Langfuse Observability** — Trace LLM calls, manage prompts remotely
- **Deep Links** — Open the extension with a specific agent and pre-filled context via URL

---

## 📦 Install

### Chrome Extension (Pre-built)

1. Download the latest **`procura-vX.Y.Z.zip`** from [**Releases**](../../releases/latest)
2. Unzip the downloaded file
3. Open Chrome → navigate to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top-right corner)
5. Click **Load unpacked** and select the unzipped folder
6. Procura appears in your sidebar — pin it for quick access

> **Tip:** To update, download the new zip, replace the folder contents, and click the reload button on `chrome://extensions`.

---

## 🏗 Architecture

```
procura/
├── frontend/    # Chrome Extension + PWA (React + Vite)
├── backend/     # API & MCP Servers (Hono + MySQL)
└── scripts/     # Dev & debugging helpers
```

The **frontend** is a Chrome extension that runs entirely in the browser. It handles LLM conversations, tool execution (browser-side tools like calculator, screenshots, file parsing), and encrypted storage.

The **backend** provides:
- **Sync API** — E2EE settings & chat sync via MySQL
- **MCP Proxy** — CORS bypass for external MCP servers
- **7 Cloud MCP Servers** — Tasks (Trello), Weather, Knowledge Base (Qdrant), CV Database (Flowcase), GitHub, Document/Media (OCR, Whisper), Image Generation (Imagen)

---

## 🚀 Quick Start

### Frontend

```bash
cd frontend
npm install
npm run dev              # Dev build (extension) with watch
npm run build:extension  # Production build (Chrome Extension)
npm run build:pwa        # Production build (PWA)
```

- **Extension**: Load `dist/` as unpacked extension in Chrome (`chrome://extensions`)
- **PWA**: Deploy `dist-pwa/` to any static hosting

### Backend (API Server)

```bash
cd backend
npm install
cp .env.example .env # Configure credentials
mysql -u root < schema.sql
npm run dev:node     # Start with hot reload
```

---

## 🔧 Tools Overview

### Browser-Side (Built-in)

| Tool | Description |
|------|-------------|
| Read Active Tab | Extract text from current page |
| Click / Type | Interact with page elements |
| Screenshot | Capture and analyze screenshots |
| File Parser | Parse JSON, CSV, Markdown, code, PDF, images |
| Calculator | Math calculations |
| Date/Time | Current date, time, weekday |
| HTTP Requests | Call external APIs |
| Schedule | Delayed message delivery |

### Cloud MCP Servers (Backend)

| Server | Tools | Powered By |
|--------|-------|------------|
| Tasks | Create, update, archive tickets | Trello |
| Weather | Current weather + forecast | OpenWeatherMap |
| Knowledge Base | Semantic search, document archival | Qdrant + OpenAI |
| CV Database | Search people, skills, load CVs | Flowcase |
| GitHub | Repos, issues, PRs, code search, Actions | GitHub API |
| Document & Media | OCR, audio transcription | OpenAI Vision + Whisper |
| Image Generation | Text-to-image | Google Imagen |

### External MCP

Connect any MCP-compatible server via Settings → MCP Servers. Supports API key and OAuth 2.0 (PKCE) authentication.

---

## 🔐 Security

- **Zero-Knowledge Sync** — All synced data is encrypted client-side before leaving the browser. The server stores opaque blobs and never sees plaintext.
- **Vault Key** — A user-defined security key is used to derive encryption keys via PBKDF2 + HKDF. The key never leaves the device.
- **API Key Auth** — Backend endpoints are protected by configurable API keys.

---

## 🧪 Testing

Run the full test and quality suite:

```bash
bash scripts/test-all.sh
```

This runs: unit & integration tests with coverage, ESLint, Semgrep, npm audit, and production builds for both frontend and backend.

---

## 📖 Documentation

| Component | README |
|-----------|--------|
| Chrome Extension | [frontend/README.md](frontend/README.md) |
| API & MCP Servers | [backend/README.md](backend/README.md) |
| Helper Scripts | [scripts/README.md](scripts/README.md) |

---

## 📄 License

MIT

---

## ⚠️ Vibe Coding Disclaimer

The source code in this repository was **generated entirely using AI coding assistants**. The author has reviewed, tested, and curated the output, but does not guarantee correctness, completeness, or fitness for any particular purpose.

As stated in the [MIT License](LICENSE):

> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

**Use at your own risk.**

