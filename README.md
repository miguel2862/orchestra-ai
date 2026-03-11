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

**Option A — Claude Max subscription** *(recommended, no API costs)*
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

**Option B — Anthropic API key**
Get yours at [console.anthropic.com](https://console.anthropic.com) and paste it during setup.

---

## 🤖 The 9-Agent Pipeline

Orchestra runs agents in a hub-and-spoke architecture. The **Developer** is at the center; quality agents orbit around it with automatic feedback loops.

```
Phase 0:  🧠 Product Manager  →  Requirements & PRD
Phase 1:  🏛  Architect        →  System design & tech stack
Phase 2:  💻  Developer        →  Full implementation (hub)
Phase 2b: 🗄  Database         →  Schema & queries (DB projects)
          ↕ (feedback loops if issues found)
Phase 3:  🔍  Error Checker    →  Bugs & type errors
          🔒  Security         →  Vulnerability audit
          🧪  Tester           →  Automated tests
          👁  Reviewer         →  Code quality
Phase 4:  🚀  Deployer         →  Starts the app & verifies
```

### Feedback Loops

If **Tester** finds failures or **Deployer** can't start the app, the pipeline automatically routes back to **Developer** for fixes — up to 2 retries per quality gate. No manual intervention needed.

---

## 🖥️ Live Dashboard

Open your browser to `http://localhost:3847` after running `orchestra-ai`.

**What you see:**
- Hub-and-spoke pipeline visualization with animated agents
- Live output stream from each agent as it works
- Real-time cost tracker (tokens + USD per agent)
- Feedback loop arrows when quality issues are routed back
- Result card with clickable localhost URLs when the app is ready

---

## ⚙️ Configuration

Everything is configurable from the **Settings** page in the web UI. Config is stored per-user:

| OS | Config location |
|----|-----------------|
| macOS / Linux | `~/.orchestra-ai/config.json` |
| Windows | `C:\Users\YourName\.orchestra-ai\config.json` |

**Available settings:**
- Anthropic API key
- GitHub token (for repo creation)
- Default projects folder
- Main model (Opus / Sonnet / Haiku)
- Subagent model (can use a cheaper model for quality agents)
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

## 💰 Model Pricing Reference

| Model | Input | Output |
|-------|-------|--------|
| Claude Opus 4 | $5 / 1M tokens | $25 / 1M tokens |
| Claude Sonnet 4 | $3 / 1M tokens | $15 / 1M tokens |
| Claude Haiku 4.5 | $1 / 1M tokens | $5 / 1M tokens |

A typical full-stack project (all agents) runs **$0.50 – $3.00** depending on complexity and model choice.

---

## 📂 Project Types

Orchestra includes built-in prompt templates for:

- **Full-stack web app** — React frontend + API backend
- **API backend** — REST or GraphQL API
- **Landing page** — Static site with modern design
- **CLI tool** — Node.js command-line utility
- **Custom** — Describe anything

---

## 🪟 Windows-Specific Notes

- Paths use backslashes internally but Orchestra handles this automatically
- The `orchestra-ai` command is available in PowerShell, CMD, and Windows Terminal after install
- If Claude Code CLI is used (Option A), Orchestra detects `claude.cmd` automatically on Windows
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
