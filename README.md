<div align="center">

# 🎵 Orchestra AI

### From idea to running app — fully autonomous.

[![npm](https://img.shields.io/npm/v/orchestra-ai-app?color=7c3aed&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/orchestra-ai-app)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?logo=github)](https://github.com/miguel2862/orchestra-ai)
[![Powered by Claude](https://img.shields.io/badge/powered%20by-Claude-orange?logo=anthropic&logoColor=white)](https://anthropic.com)

<br/>

**You describe a project. Nine specialized AI agents collaborate to build it — writing code, running tests, fixing bugs, and deploying — all without you lifting a finger.**

<br/>

[📦 npm package](https://www.npmjs.com/package/orchestra-ai-app) · [🐛 Issues](https://github.com/miguel2862/orchestra-ai/issues) · [🤖 Powered by Claude Agent SDK](https://github.com/anthropics/claude-code)

<br/>

![Agent Pipeline with active feedback loop](assets/screenshots/pipeline-feedback.jpeg)

</div>

---

## ⚡ Three steps. One running app.

```bash
npm install -g orchestra-ai-app   # 1. install once
orchestra-ai                       # 2. run
# 3. describe your project in the browser — agents do the rest
```

A browser window opens automatically. Nine agents start working. You watch the live dashboard.

---

## 🏗️ Architecture — Star Topology, not a pipeline

Most AI coding tools run agents in a straight line: A → B → C → D.
If D fails, the build stops. You start over.

**Orchestra is different.** The **Developer** agent sits at the center of a star. Every quality agent — Error Checker, Security, Tester, Reviewer — branches out from Developer, and can loop *back* to Developer with a detailed report when they find problems. Failures become **automatic retries**, not dead ends.

```mermaid
flowchart TD
    IDEA(["💡 Your Idea"])

    IDEA --> PM

    PM["🧠 Product Manager\nWrites requirements & PRD"]
    PM --> ARCH

    ARCH["🏛️ Architect\nDesigns system & picks stack"]
    ARCH --> DEV

    DEV["💻 Developer\n\n  ★  HUB  ★\n\nCenter of the star.\nAll quality agents\nreport back here."]

    DEV --> EC
    DEV --> SEC
    DEV --> TEST
    DEV --> REV
    DEV -.- DB[("🗄️ Database\noptional")]

    EC["🔍 Error Checker\nType errors & bugs"]
    SEC["🔒 Security\nVulnerabilities & CVEs"]
    TEST["🧪 Tester\nUnit & integration tests"]
    REV["👁️ Reviewer\nCode quality & patterns"]

    EC -.->|"❌ issues found — retry × 3"| DEV
    SEC -.->|"❌ CVE found — retry × 2"| DEV
    TEST -.->|"❌ tests fail — retry × 3"| DEV
    REV -.->|"❌ critical issues — retry × 3"| DEV

    EC --> DEPLOY
    SEC --> DEPLOY
    TEST --> DEPLOY
    REV --> DEPLOY

    DEPLOY["🚀 Deployer\nStarts & verifies the app"]
    DEPLOY -.->|"❌ won't start — retry × 2"| DEV
    DEPLOY --> DONE(["✅ Your app is live"])

    style DEV fill:#4c1d95,color:#e9d5ff,stroke:#7c3aed,stroke-width:3px
    style DONE fill:#064e3b,color:#d1fae5,stroke:#10b981,stroke-width:2px
    style IDEA fill:#1e3a5f,color:#bfdbfe,stroke:#3b82f6,stroke-width:2px
```

> **Solid arrows** → forward pass (sequential phases).
> **Dashed arrows** → feedback loops (automatic, only triggered when issues are found).

---

## 🤖 The 9 agents — who does what

| Agent | Phase | Role | Key tools |
|-------|:-----:|------|-----------|
| 🧠 **Product Manager** | `0 · Plan` | Clarifies scope and writes a full Product Requirements Doc | Memory, Web Search |
| 🏛️ **Architect** | `1 · Design` | Chooses tech stack, designs folder structure, plans APIs | Web Search, Memory |
| 💻 **Developer** | `2 · Build ⭐` | **Writes all the code.** The hub — receives from Architect, routes feedback from all quality agents | Filesystem, Search, Memory |
| 🗄️ **Database** | `2 · Build` | Designs schema, writes migrations, seeds (only when the project needs a DB) | Filesystem, Postgres |
| 🔍 **Error Checker** | `3 · Quality` | Scans for TypeScript errors, syntax bugs, missing imports, runtime crashes | Filesystem |
| 🔒 **Security** | `3 · Quality` | Finds injection flaws, insecure auth, exposed secrets, known CVEs | Web Search, Filesystem |
| 🧪 **Tester** | `3 · Quality` | Writes and runs unit & integration tests, reports coverage | Filesystem, Browser |
| 👁️ **Reviewer** | `3 · Quality` | Reviews code patterns, readability, coupling, and best practices | Filesystem |
| 🚀 **Deployer** | `4 · Ship` | Starts the app, hits real endpoints, verifies it responds correctly | Browser, Filesystem |

> **Phase 3 quality agents run in parallel.** They all check the same codebase simultaneously and independently route feedback to Developer.

---

## 🔄 Automatic feedback loops

When a quality agent finds a problem, it sends Developer a structured report — *what broke, where, why, and what to fix.* Developer fixes it. The quality agent re-checks.

```
  Quality agent ──── ❌ issue report ────► Developer ──── fix ────► Quality agent re-checks
       ▲                                                                       │
       └───────────────────── up to N retries ───────────────────────────────┘
```

| Quality gate | Triggers when… | Max retries |
|---|---|:---:|
| 🔍 **Error Checker** | TypeScript errors, syntax errors, runtime exceptions | **3** |
| 🧪 **Tester** | Any unit or integration test is failing | **3** |
| 🔒 **Security** | A critical vulnerability is detected | **2** |
| 👁️ **Reviewer** | A critical code quality issue is flagged | **3** |
| 🚀 **Deployer** | The app fails to start or endpoints don't respond | **2** |

**When retries are exhausted:** if issues remain after the last retry, the pipeline continues to the next phase rather than stopping the entire build. The unresolved issues are recorded in the run log (`.orchestra/run_*.json` inside the project folder) so you can review exactly what was found and what couldn't be fully resolved.

> **No manual intervention is needed at any point.** Even partial results are almost always a working base — usually a single targeted fix is all that's left.

---

## 🖥️ Live dashboard

After running `orchestra-ai`, your browser opens automatically. You get a real-time view of everything happening:


| Feature | What you see |
|---------|-------------|
| **Hub-and-spoke visualization** | The star topology rendered live — agents light up as they activate |
| **Live output stream** | Every line each agent writes, thinks, and decides — in real time |
| **Cost tracker** | Token count and USD per agent, updating as they run |
| **Feedback loop arrows** | Animated amber arrows when a quality gate loops back to Developer |
| **Result card** | Clickable `localhost` URL when your app is ready |
| **History** | Every past run saved — browse previous projects and their full event logs |

> Port defaults to **3847** but auto-reassigns if busy. You can **run multiple projects simultaneously** — each is tracked independently with its own event stream.

---

## 📁 What gets generated

After a full run, your project folder looks like this:

```
my-project/
├── src/                  # all source code written by Developer
├── tests/                # test files written by Tester
├── package.json
├── README.md             # auto-generated project README
├── .env.example          # environment variables template
└── .orchestra/
    ├── run_1712345678.json   # full run memory: cost, agent stats, issues found
    └── profile.json          # aggregated stats across all runs on this project
```

The `.orchestra/` folder is how Orchestra remembers what it built — if you continue or modify the project later, agents can read prior run context.

---

## 🚀 Quick Start

| | |
|---|---|
| ![New Project — describe your idea](assets/screenshots/new-project.jpeg) | ![Agent configuration and model selection](assets/screenshots/new-project-model.jpeg) |

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

<details>
<summary>Windows execution policy error?</summary>

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Then re-run `orchestra-ai`.

</details>

On first launch, a **30-second setup wizard** runs automatically — auth method, GitHub token (optional), working directory, and theme.

---

## 📋 Requirements

| | |
|--|--|
| **Node.js** | v18 or higher — [download here](https://nodejs.org) |
| **Claude auth** | Any plan below — Pro, Max, or API key |

### Which Anthropic plan do I need?

| Plan | Price | Works? | Usage |
|---|---|:---:|---|
| **Claude Pro** | $20 / mo | ✅ | Included in plan — lower limits |
| **Claude Max 5×** | $100 / mo | ✅ | 5× more usage than Pro |
| **Claude Max 20×** | $200 / mo | ✅ | 20× more usage than Pro |
| **API key only** | Pay per token | ✅ | No limits — billed directly |

> All plans share the same token pool with claude.ai. Max is recommended for heavy daily use.

**Option A — Claude subscription (Pro or Max)** *(recommended — usage included in plan)*
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

**Option B — Anthropic API key** *(pay per token)*
Get yours at [console.anthropic.com](https://console.anthropic.com) and paste it during the setup wizard.

---

## 💰 Cost

![Claude usage panel — session and weekly limits live](assets/screenshots/usage.jpeg)

### With a Claude subscription
**No extra token cost.** Usage counts against your plan's session and weekly limits. The dashboard shows both live.

### With an API key

| Model | Input | Output | Best for |
|-------|------:|------:|---------|
| **Opus 4.6** | $5 / 1M | $25 / 1M | Most complex, long projects |
| **Sonnet 4.6** | $3 / 1M | $15 / 1M | ✅ Recommended balance |
| **Haiku 4.5** | $1 / 1M | $5 / 1M | Fastest, cheapest |

A typical full-stack project (all 9 agents on Sonnet 4.6): **$0.50 – $3.00** depending on complexity.
You can assign a cheaper model to quality-only agents in Settings to cut costs significantly.

> Always verify current prices at [anthropic.com/pricing](https://www.anthropic.com/pricing).

Orchestra always uses the **latest stable model** in each family — no hardcoded version dates that go stale.

---

## ⚙️ Configuration

Everything is configurable from the **Settings** page in the web UI. Config is stored per-user:

| OS | Config location |
|----|-----------------|
| macOS / Linux | `~/.orchestra-ai/config.json` |
| Windows | `C:\Users\YourName\.orchestra-ai\config.json` |

<details>
<summary>All available settings</summary>

| Setting | Description |
|---------|-------------|
| Anthropic API key | For API key auth (Option B) |
| GitHub token | Lets agents create repos and push code |
| Default projects folder | Where new projects are created |
| Main model | Opus 4.6 / Sonnet 4.6 / Haiku 4.5 |
| Subagent model | Use a cheaper model for quality gates to reduce cost |
| Extended thinking | Deeper reasoning for complex projects |
| Budget cap | Maximum USD spend per project |
| Max turns | Hard limit on agent iterations |
| Git auto-commits | Commit after each completed phase |
| UI theme | Dark / Light / System |

</details>

---

## 🧩 MCP Servers

Orchestra uses the [Model Context Protocol](https://modelcontextprotocol.io) to give agents real tools — not just text generation:

| Server | Gives agents the ability to… |
|--------|------------------------------|
| `filesystem` | Read, write, and navigate project files |
| `brave-search` | Search the web for docs, packages, examples |
| `github` | Create repositories and push code |
| `puppeteer` | Control a real browser — screenshots, UI testing |
| `postgres` | Inspect and query databases live |
| `memory` | Share persistent context across all agents |

Enable or disable each server from **Settings → MCP Servers**.

---

## 📂 Project templates

| Template | What it builds |
|----------|----------------|
| **Full-stack web app** | React frontend + Node/Express API |
| **API backend** | REST or GraphQL API with auth |
| **Landing page** | Static site with modern design |
| **CLI tool** | Node.js command-line utility |
| **Custom** | Describe anything in plain English |

---

## ❓ Frequently asked

<details>
<summary>Does it work on existing projects or only new ones?</summary>

Currently Orchestra is optimized for **building new projects from scratch**. Running it on an existing codebase is possible but the agents will treat the existing files as their starting context — results may vary. A "continue existing project" mode is on the roadmap.

</details>

<details>
<summary>Can I stop a run midway and resume it?</summary>

Yes — and it picks up exactly where it left off. When you click **Stop**, Orchestra saves the Claude session ID. When you click **Continue**, it uses the Claude Agent SDK's built-in session resume to restore the full conversation context: which agents ran, what code was written, where the pipeline was. Claude doesn't start over — it continues from that exact point.

Note: the **Continue** button appears after the run ends (completed, failed, or stopped). There is no mid-run pause — Stop is immediate.

</details>

<details>
<summary>What happens if Claude hits a rate limit mid-run?</summary>

The Claude Agent SDK handles rate limit retries automatically with exponential backoff. If the limit is sustained (e.g., a weekly cap is reached), the active agent will fail and the run will report an error. Your generated files up to that point are preserved.

</details>

<details>
<summary>Can I run multiple projects at the same time?</summary>

Yes. The server tracks each run independently in memory and on disk. Start a second project from "New Project" while the first is running — both appear in the sidebar with their own live output streams. Keep in mind that parallel runs consume tokens in parallel, which hits subscription limits faster.

</details>

<details>
<summary>Where are my projects and run history saved?</summary>

- **Project files** → the working directory you chose during setup (default: `~/orchestra-projects/`)
- **Run logs** → `~/.claude/projects/` — one JSON file and one JSONL event log per project
- **Run memory** → inside each project at `.orchestra/run_*.json`

</details>

<details>
<summary>Is my API key or GitHub token stored securely?</summary>

Both are stored in `~/.orchestra-ai/config.json` on your local machine — they never leave your device except when making API calls directly to Anthropic or GitHub. Orchestra does not have a backend server; everything runs locally.

</details>

---

## 🔧 Troubleshooting

<details>
<summary>Updating to a new version — "file already exists" error</summary>

If you already have Orchestra installed and `npm install -g orchestra-ai-app` throws an `EEXIST` error, uninstall first:

```bash
npm uninstall -g orchestra-ai-app && npm install -g orchestra-ai-app
```

</details>

<details>
<summary>Command not found after install</summary>

Make sure npm's global bin directory is in your `PATH`. Run `npm bin -g` to find it, then add it to your shell profile (`.zshrc`, `.bashrc`, etc.).

On macOS with Homebrew-managed Node, the global bin is usually `/opt/homebrew/bin` — which is already in PATH by default.

</details>

<details>
<summary>Browser doesn't open automatically</summary>

Navigate manually to `http://localhost:3847` (or whatever port is shown in the terminal output). On Windows, `start` and `open` commands can sometimes be blocked by security policies.

</details>

<details>
<summary>orchestra-ai hangs on startup</summary>

Check that port 3847 (or whichever port it picked) isn't blocked by a firewall. Try stopping any other local servers and rerunning. You can also check the terminal for the exact port being used.

</details>

---

## 🪟 Windows notes

- Paths use platform-native separators — handled automatically
- `orchestra-ai` works in PowerShell, CMD, and Windows Terminal
- Orchestra auto-detects `claude.cmd` when using Option A
- Projects default to `C:\Users\YourName\orchestra-projects\`

---

## 🛠️ Development

<details>
<summary>Run locally from source</summary>

```bash
git clone https://github.com/miguel2862/orchestra-ai.git
cd orchestra-ai
npm install
npm run dev        # starts server + UI in watch mode
```

```bash
npm run build      # production build
npm run typecheck  # TypeScript check with no emit
```

</details>

---

## 📄 License

MIT — free to use, modify, and distribute.

---

<div align="center">

Built with the [Claude Agent SDK](https://github.com/anthropics/claude-code) by Anthropic

</div>
