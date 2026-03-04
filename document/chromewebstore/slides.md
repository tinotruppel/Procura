---
marp: true
theme: default
paginate: false
style: |
  /* ─── Slide size: 1280×800 for CWS ─── */
  section {
    width: 1280px;
    height: 800px;
    background: linear-gradient(135deg, #f8f9fc 0%, #eef1f8 100%);
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #1a1a2e;
    padding: 40px 60px;
  }

  /* ─── Headline ─── */
  h1 {
    font-size: 2.1em;
    font-weight: 800;
    text-align: center;
    margin: 0 0 6px 0;
    color: #1a1a2e;
    letter-spacing: -0.02em;
  }

  h1 em {
    font-style: normal;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* ─── Subtitle ─── */
  h2 {
    font-size: 1.05em;
    font-weight: 400;
    text-align: center;
    color: #64748b;
    margin: 0 0 24px 0;
  }

  /* ─── Portrait screenshot pair ─── */
  .screenshots-portrait {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 36px;
    margin-top: 8px;
  }

  .screenshots-portrait img {
    height: 500px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  /* ─── Landscape screenshot pair ─── */
  .screenshots-landscape {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin-top: 4px;
  }

  .screenshots-landscape img {
    width: 540px;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  .screenshots-landscape-row {
    display: flex;
    justify-content: center;
    gap: 24px;
  }

  /* ─── Caption under screenshots ─── */
  .caption {
    display: flex;
    justify-content: center;
    gap: 36px;
    margin-top: 10px;
  }

  .caption span {
    width: 280px;
    text-align: center;
    font-size: 0.82em;
    color: #64748b;
  }

  .caption-landscape {
    display: flex;
    justify-content: center;
    gap: 24px;
    margin-top: 8px;
  }

  .caption-landscape span {
    width: 540px;
    text-align: center;
    font-size: 0.82em;
    color: #64748b;
  }

  /* ─── Feature pills ─── */
  .features {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin-top: 14px;
    flex-wrap: wrap;
  }

  .features span {
    background: rgba(99, 102, 241, 0.08);
    color: #6366f1;
    padding: 5px 14px;
    border-radius: 20px;
    font-size: 0.78em;
    font-weight: 500;
  }
---

<!-- Slide 1: Chat & AI -->

# Your AI Assistant, *Right in the Browser*
## Multi-provider LLM support with rich Markdown, diagrams & presentations

<div class="screenshots-portrait">
  <img src="screenshots/chat-conversation.png" alt="Chat conversation" />
  <img src="screenshots/mermaid-diagram.png" alt="Mermaid diagram rendering" />
</div>

<div class="caption">
  <span>Chat with GPT, Claude, Gemini — rich formatting & bold highlights</span>
  <span>Sequence diagrams, flowcharts & more rendered inline via Mermaid</span>
</div>

---

<!-- Slide 2: Tools & Browser Interaction -->

# *AI-Powered* Browser Automation
## Read pages, interact with elements, and let the AI take action for you

<div class="screenshots-landscape">
  <div class="screenshots-landscape-row">
    <img src="screenshots/tool-usage.png" alt="Page reading and summarization" />
    <img src="screenshots/web-interaction.png" alt="Web interaction and shopping" />
  </div>
</div>

<div class="caption-landscape">
  <span>Read any page and get instant summaries with key points</span>
  <span>Navigate, search, click & type — the AI controls the browser for you</span>
</div>

---

<!-- Slide 3: Settings & MCP -->

# Fully Configurable & *Extensible*
## Connect external services via MCP — encrypted sync across devices

<div class="screenshots-portrait">
  <img src="screenshots/settings.png" alt="Settings" />
  <img src="screenshots/mcp-servers.png" alt="MCP server configuration" />
</div>

<div class="caption">
  <span>Choose your provider, model, theme & system prompts</span>
  <span>Add MCP servers for Trello, GitHub, Weather, Knowledge Base & more</span>
</div>

<div class="features">
  <span>🔒 Zero-Knowledge Sync</span>
  <span>🛠 MCP Protocol</span>
  <span>📊 Langfuse Tracing</span>
  <span>🔗 Deep Links</span>
</div>
