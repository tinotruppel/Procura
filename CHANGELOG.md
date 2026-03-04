# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-03-04

### Added

- **Google Workspace MCP Migration** — Moved Google Docs, Sheets to backend MCP with unified OAuth flow
- **Google Slides** — New tool with 8 operations (create, read, append, duplicate slides, etc.)
- **Gmail & Google Calendar** — New MCP endpoints for email and calendar integration
- **Dynamic Model Lists** — Fetch available models from OpenAI, Claude, and Gemini APIs in real-time
- **PWA Web Share Target** — Receive shared text, URLs, files, and images from other apps with precise routing
- **Biometric Vault Unlock** — WebAuthn PRF-based vault unlock with dynamic theme-color support
- **Langfuse Prompt Tags** — Tag filter for prompt selection and Test Connection
- **Data Retention** — Backend `/cron/cleanup` endpoint for automatic removal of inactive user data (90 days)
- **RFC 9728 OAuth Discovery** — OAuth discovery for MCP servers, proxy bypass for own MCPs, intervention display
- **Chrome Web Store Publishing** — Scripts for CWS API setup (`cws-setup.sh`), upload/publish (`cws-publish.sh`), and screenshot generation (`cws-screenshots.sh`)
- **Privacy Policy** — `PRIVACY_POLICY.md` for Chrome Web Store compliance
- **CWS Store Listing Assets** — Marp-based screenshot slides for Chrome Web Store listing

### Changed

- **Release Script** — Now supports `--cws` flag to publish to Chrome Web Store after GitHub Release
- **`.env.example`** — Added placeholders for Chrome Web Store API credentials
- **Markdown Parser** — Extracted to standalone module with improved test coverage

### Fixed

- **Auto-switch theme** — OS theme change now applies immediately when set to "System"
- **Intervention Queue** — Fixed stale closure preventing sequential append; support multiple queued interventions
- **Scheduled Messages** — Display as assistant messages with correct timestamp
- **System Prompt Persistence** — Selection now persists to chat session immediately
- **File Reference Resolution** — Resolve file references by fileName fallback
- **New Chat on Share** — Start new chat when receiving shared content via Web Share Target
- **Audit Vulnerabilities** — Fixed npm audit issues

### Added

- **Version Display** — Show app version at the bottom of Settings (`v0.1.1` in production, `v0.1.1-dev` in dev builds)
- **Automated Release Workflow** — `release.sh` now builds the Chrome Extension, zips it, pushes, and creates a GitHub Release with the zip attached
- **Installation Guide** — README includes step-by-step Chrome Extension install instructions

### Fixed

- **CV Database MCP** — Strip excessively long signed S3 image URLs from responses to reduce LLM context window usage

## [0.1.0] - 2026-02-11

### Added

- **Multi-Provider LLM Support** — Gemini, Claude, OpenAI, and any OpenAI-compatible endpoint
- **Chrome Extension** — Side panel UI with chat, settings, and tool management
- **Progressive Web App (PWA)** — Standalone web app with offline support
- **Built-in Browser Tools** — Read pages, click elements, take screenshots, parse files, calculator, date/time, HTTP requests, scheduling
- **MCP Tool Servers** — Tasks (Trello), Weather (OpenWeatherMap), Knowledge Base (Qdrant), CV Database (Flowcase), GitHub, Document & Media (OCR/Whisper), Image Generation (Imagen)
- **End-to-End Encrypted Sync** — Zero-knowledge settings and chat sync across devices
- **Mermaid Diagrams** — Render flowcharts, sequences, XY charts, and more in chat
- **Marpit Presentations** — Create slide decks with Marpit markdown syntax
- **Langfuse Integration** — LLM tracing, remote prompts, and prompt variables
- **Deep Links** — Open the extension with a specific agent and pre-filled context via URL
- **MCP Proxy** — CORS bypass for connecting to external MCP servers
- **Google Workspace** — Google Docs and Google Sheets integration
- **Config Export/Import** — Encrypted settings export with vault key protection
