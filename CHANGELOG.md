# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-02-11

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
