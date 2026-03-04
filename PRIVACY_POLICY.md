# Procura — Privacy Policy

**Effective Date:** February 25, 2026

Thank you for using Procura. This Privacy Policy explains how the Procura browser extension ("Extension") handles your data.

---

## 1. Overview

Procura is an AI-powered browser assistant. It runs **entirely in your browser** — no data is collected, transmitted, or stored by the Extension developer unless you explicitly enable the optional Cloud Sync feature.

---

## 2. Data Collected

### 2.1 Data Stored Locally (in your browser)

The following data is stored **locally in Chrome's extension storage** on your device and is never transmitted without your action:

- **LLM API keys** — Provider credentials you configure (OpenAI, Google, Anthropic, etc.)
- **Chat history** — Conversations with AI models
- **Settings & preferences** — UI configuration, tool settings, agent configurations
- **MCP server configurations** — URLs and credentials for external tool servers you connect

### 2.2 Data Transmitted to Third Parties (by your configuration)

When you use the Extension, it sends requests **directly from your browser** to the LLM providers and MCP servers **you** configure:

- **LLM API requests** — Your prompts and conversation history are sent to the LLM provider you select (e.g., OpenAI, Google Gemini, Anthropic Claude). These requests go directly from your browser to the provider's API. Procura does not proxy, log, or store these requests.
- **MCP tool calls** — If you connect external tool servers (e.g., Trello, GitHub, Weather), requests are sent to those services as configured by you.

### 2.3 Optional Cloud Sync (opt-in)

If you enable Cloud Sync in Settings, the following applies:

- Your settings and chat history are **encrypted client-side** (AES-256-GCM) before leaving your browser using a Vault Key that **only you know**.
- The encrypted blobs are transmitted to and stored on the Procura sync server.
- **The server has zero knowledge of your data.** It stores opaque encrypted blobs and cannot decrypt them.
- Encryption keys are derived from your Vault Key using PBKDF2 + HKDF and never leave your device.

### 2.4 Optional Langfuse Integration (opt-in)

If you enable Langfuse observability in Settings, LLM call traces are sent to your configured Langfuse instance. This is entirely opt-in and uses credentials you provide.

---

## 3. Data NOT Collected

Procura does **not** collect:

- Browsing history or web activity (beyond the active tab when you explicitly invoke a browser tool)
- Personal information, emails, or contacts
- Usage analytics or telemetry
- Advertising identifiers or tracking data
- Data for profiling or personalization

---

## 4. Browser Permissions

The Extension requests the following permissions:

| Permission | Purpose |
|-----------|---------|
| `storage` | Store settings, chat history, and API keys locally |
| `sidePanel` | Display the Extension UI in Chrome's side panel |
| `activeTab` | Read page content when you invoke the "Read Active Tab" tool |
| `tabs` | Access tab information for browser interaction tools |
| `scripting` | Inject content scripts for screenshot capture and deep link handling |
| `identity` | OAuth authentication for Google Workspace integrations (Docs, Sheets) |
| `<all_urls>` (host) | Enable browser tools (read page, click, screenshot) to work on any website you choose to interact with |

All browser tool actions (reading a page, taking a screenshot, clicking elements) are **only triggered by explicit user action** within the Extension. Nothing runs automatically in the background.

---

## 5. Data Sharing

- We do **not** sell your data to third parties, data brokers, or information resellers.
- We do **not** use your data for advertising or personalized ads.
- We do **not** share your data with anyone except as described in Section 2 (i.e., only to the services you explicitly configure).

---

## 6. Data Retention & Deletion

- **Local data** is stored in Chrome's extension storage and is deleted when you uninstall the Extension or clear extension data via `chrome://extensions`.
- **Cloud Sync data** (if enabled): Disabling Cloud Sync makes all server-side encrypted blobs inaccessible, as only your device holds the decryption key. Encrypted blobs from users who have not synced within 90 days are automatically deleted from the server.
- You can export your settings at any time via Settings → Export.

---

## 7. Children's Privacy

Procura is not directed at children under 13. We do not knowingly collect data from children.

---

## 8. Open Source & Transparency

Procura is open source under the [MIT License](https://github.com/tinotruppel/procura). All claims in this privacy policy can be independently verified by reviewing the source code.

---

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected by updating the "Effective Date" at the top and publishing the updated policy in this repository.

---

## 10. Contact

If you have questions about this Privacy Policy or your data, please contact:

**Tino Truppel**
GitHub: [github.com/tinotruppel/procura](https://github.com/tinotruppel/procura)
