<div align="center">

# 🎵 Orchestra AI

### Build entire projects with a single command — powered by Claude

[![npm](https://img.shields.io/npm/v/orchestra-ai-app?color=7c3aed&label=npm&logo=npm)](https://www.npmjs.com/package/orchestra-ai-app)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?logo=github)](https://github.com/miguel2862/orchestra-ai)

Orchestra AI orchestrates **9 specialized AI agents** that take your idea from requirements to a running app — automatically. A live web dashboard shows every agent working in real time.

</div>

---

## ✨ What it does

You describe a project. Orchestra runs a full pipeline of AI agents — each one specialized — that collaborate to build it:

```
Your idea → PRD → Architecture → Code → Tests → Security → Deploy
```

No manual handoffs. No copy-pasting between AI chats. One command.

---

## 🚀 Quick Start

### macOS / Linux

```bash
npm install -g orchestra-ai-app
orchestra-ai
```

### Windows

Open **PowerShell** or **Command Prompt** as Administrator:

```powershell
npm install -g orchestra-ai-app
orchestra-ai
```

> **Note for Windows**: If you get an execution policy error, run:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

On first launch, a setup wizard runs automatically — it takes about 30 seconds.

---

## 📋 Requirements

| Requirement | Details |
|-------------|---------|
| **Node.js** | v18 or higher — [download](https://nodejs.org) |
| **Claude auth** | One of the two options below |

### Which Anthropic plan do I need?

| Plan | Monthly | Works with Orchestra? | Claude Code usage |
|---|---|---|---|
| **Claude Pro** | $20 | ✅ Yes | Included — lower usage limits |
| **Claude Max 5x** | $100 | ✅ Yes | 5× more usage than Pro |
| **Claude Max 20x** | $200 | ✅ Yes | 20× more usage than Pro |
| **API key only** | Pay per token | ✅ Yes | Unlimited (billed per token) |

> **Pro, Max 5x, and Max 20x all include Claude Code** in the same subscription. The difference is how many tokens you can use per session and per week before hitting the limit. For daily heavy coding use, Max is recommended.

---

**Option A — Claude subscription (Pro or Max)** *(recommended — usage included in your plan)*
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

**Option B — Anthropic API key** *(pay per token — useful if you hit your plan limits or prefer direct billing)*
Get yours at [console.anthropic.com](https://console.anthropic.com) and paste it during the setup wizard.

---

## 🤖 Star Topology Pipeline (non-linear)

Orchestra uses a **star / hub-and-spoke architecture**, not a simple linear chain. The **Developer** agent sits at the center — it receives inputs from the orchestrator and routes feedback from all quality agents. This allows failed quality checks to loop back automatically without restarting the whole pipeline.

```
Phase 0:  🧠 Product Manager  →  Requirements & PRD
Phase 1:  🏛  Architect        →  System design & tech stack
                                          │
Phase 2:  💻  Developer  ◄────────────── ┤  ← hub (all quality agents connect here)
          🗄  Database (optional)         │
                    │                     │
        ┌───────────┼───────────┐         │
Phase 3: 🔍 Error   🔒 Security  🧪 Tester  👁 Reviewer
        └───────────┼───────────┘
                    │  (feedback loops if issues found — up to 2 retries)
                    └────────────── back to Developer ──►
                                          │
Phase 4:  🚀  Deployer         →  Starts the app & verifies
```

### Automatic Feedback Loops

If any quality agent finds problems, it automatically routes back to **Developer** for fixes:

| Quality Gate | Trigger | Max retries |
|---|---|---|
| Error Checker | Type errors / bugs | 2 |
| Tester | Failing tests | 2 |
| Reviewer | Critical code issues | 1 |
| Deployer | App won't start | 1 |

No manual intervention needed.

---

## 🖥️ Live Dashboard

After running `orchestra-ai`, your browser opens automatically. The port defaults to **3847** but is reassigned automatically if that port is already in use.

**What you see:**
- Hub-and-spoke pipeline visualization with animated agents
- Live output stream from each agent as it works
- Real-time cost tracker (tokens + USD per agent)
- Feedback loop arrows when quality issues are routed back to Developer
- Result card with clickable localhost URLs when the app is ready

---

## 💰 Cost

### Claude Max subscription (Option A)
**No token costs** — usage counts against your Claude Max plan limits, shown live in the Usage panel (session 5h window + weekly 7-day window).

### Anthropic API key (Option B)
You pay per token. Current model pricing:

| Model | Input | Output |
|-------|-------|--------|
| Claude Opus 4.6 *(most capable)* | $5 / 1M tokens | $25 / 1M tokens |
| Claude Sonnet 4.6 *(recommended)* | $3 / 1M tokens | $15 / 1M tokens |
| Claude Haiku 4.5 *(fastest/cheapest)* | $1 / 1M tokens | $5 / 1M tokens |

> Prices may change — always check [anthropic.com/pricing](https://www.anthropic.com/pricing) for the latest.

A typical full-stack project (all 9 agents, Sonnet) runs approximately **$0.50 – $3.00** depending on project complexity. You can reduce cost by using Haiku for subagents in Settings.

Orchestra always uses the **latest stable model** in each family — no hardcoded dates that go stale.

---

## ⚙️ Configuration

Everything is configurable from the **Settings** page in the web UI. Config is stored per-user:

| OS | Config location |
|----|-----------------|
| macOS / Linux | `~/.orchestra-ai/config.json` |
| Windows | `C:\Users\YourName\.orchestra-ai\config.json` |

**Available settings:**
- Anthropic API key
- GitHub token (for repo creation during projects)
- Default projects folder
- Main model (Opus 4.6 / Sonnet 4.6 / Haiku 4.5)
- Subagent model (use a cheaper model for quality agents to reduce cost)
- Extended thinking on/off
- Budget limit per project (USD)
- Max turns limit
- Git auto-commits
- UI theme (dark / light / system)

---

## 🧩 MCP Servers

Orchestra uses the [Model Context Protocol](https://modelcontextprotocol.io) to give agents real tools:

| Server | What it provides |
|--------|-----------------|
| `filesystem` | Read/write project files |
| `brave-search` | Web search for docs & examples |
| `github` | Create repos, push code |
| `puppeteer` | Browser automation & screenshots |
| `postgres` | Database inspection |
| `memory` | Cross-agent persistent memory |

Enable/disable each from **Settings → MCP Servers**.

---

## 📂 Project Templates

Orchestra includes built-in prompt templates for:

- **Full-stack web app** — React frontend + API backend
- **API backend** — REST or GraphQL API
- **Landing page** — Static site with modern design
- **CLI tool** — Node.js command-line utility
- **Custom** — Describe anything

---

## 🪟 Windows-Specific Notes

- Paths use platform-native separators — handled automatically
- The `orchestra-ai` command works in PowerShell, CMD, and Windows Terminal
- If using Claude Code CLI (Option A), Orchestra detects `claude.cmd` automatically
- Projects are saved to `C:\Users\YourName\orchestra-projects\` by default

---

## 🛠️ Development

Clone and run locally:

```bash
git clone https://github.com/miguel2862/orchestra-ai.git
cd orchestra-ai
npm install
npm run dev     # starts server + UI in watch mode
```

Build for production:

```bash
npm run build
```

Typecheck:

```bash
npm run typecheck
```

---

## 📄 License

MIT — free to use, modify, and distribute.

---

<div align="center">

Built with [Claude Agent SDK](https://github.com/anthropics/claude-code) by Anthropic

</div>
