# MuchovhaOS

An autonomous AI agent embedded in a live Linux operating system. MuchovhaOS gives a Gemini-powered agent direct access to a real environment — terminal, filesystem, processes, network — through a browser-based mission control dashboard.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser — React Dashboard                              │
│  ┌───────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐  │
│  │ Terminal   │ │ Agent    │ │ System │ │ Alert Feed │  │
│  │ (xterm.js)│ │ Timeline │ │ Vitals │ │ + AutoHeal │  │
│  └─────┬─────┘ └────┬─────┘ └───┬────┘ └─────┬──────┘  │
│        │WS          │SSE        │REST         │REST     │
└────────┼────────────┼───────────┼─────────────┼─────────┘
         │            │           │             │
┌────────┴────────────┴───────────┴─────────────┴─────────┐
│  FastAPI Backend (Python)                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Agent Loop (ReAct)                              │   │
│  │  Gemini 3 → Think → Tool Call → Execute → Loop   │   │
│  └──────────┬───────────────────────────────────────┘   │
│  ┌──────────┴──┐ ┌──────────┐ ┌───────┐ ┌──────────┐   │
│  │ 13 Tools    │ │ Skills   │ │  PTY  │ │ Health   │   │
│  │ (sandbox,   │ │ Engine   │ │ Mgr   │ │ Monitor  │   │
│  │  fs, net..) │ │ (hot-    │ │       │ │ (auto-   │   │
│  │             │ │  reload) │ │       │ │  heal)   │   │
│  └──────┬──────┘ └──────────┘ └───────┘ └──────────┘   │
│         │                                               │
│  ┌──────┴──────────────────────────────────────┐        │
│  │  C++ Kernel (pybind11)                      │        │
│  │  process | sandbox | metrics | network      │        │
│  │  cgroup  | fs_watcher | file_utils          │        │
│  └─────────────────────────────────────────────┘        │
│                                                         │
│  ┌─────────────────────────────────────────────┐        │
│  │  FastMCP Server (/mcp)                      │        │
│  │ 
│  └─────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

**Backend** — FastAPI app serving REST endpoints, an SSE agent stream, a WebSocket PTY terminal, and a FastMCP server. The agent loop calls Gemini 3 in a ReAct cycle: think, pick a tool, execute, observe, repeat.

**C++ Kernel** — Performance-critical system operations (process management, sandboxed command execution, metrics, networking, cgroups, filesystem watching) compiled as a Python extension via pybind11. Releases the GIL on every call.

**Frontend** — React + TypeScript + Zustand SPA. Embeds a full xterm.js terminal, an agent activity timeline with markdown rendering, real-time system gauges, and a health alert feed.

**Skills** — Extensible capability modules (SKILL.md files). Discovered from `skills/` (bundled), `/etc/muchovhaos/skills/`, and `~/skills/`, hot-reloaded via inotify, injected into the agent's prompt on activation.

**Health Monitor** — Background loop checking CPU, memory, disk, zombie processes, and new ports every 5 seconds. Auto-heal mode triggers the agent to diagnose and fix anomalies autonomously.

## System Flow

1. User types a goal in the command bar (or the health monitor triggers auto-heal).
2. The frontend POSTs to `/api/agent/run` and opens an SSE stream.
3. The backend builds the conversation (system prompt + skills context + history + user message) and calls Gemini 3 with function declarations for all 13 tools.
4. Gemini responds with thinking + tool calls or a final text answer.
5. Tool calls are executed (commands via the C++ sandbox, other tools via kernel modules or Python). Results are fed back to Gemini.
6. Steps 4–5 repeat (up to 15 iterations) until Gemini produces a text-only response.
7. Every event (status, thought, tool_call, tool_result, text, done) is streamed as SSE to the frontend timeline in real time.

## Dependencies

### Backend (Python)

| Package | Purpose |
|---|---|
| `fastapi` | Web framework + API |
| `uvicorn[standard]` | ASGI server |
| `websockets` | Terminal WebSocket |
| `google-genai` | Gemini API client |
| `python-dotenv` | `.env` loading |
| `python-multipart` | File uploads |
| `fastmcp` | MCP server |
| `pyyaml` | Skill frontmatter parsing |

### Frontend (Node)

| Package | Purpose |
|---|---|
| `react` / `react-dom` | UI framework |
| `zustand` | State management |
| `@xterm/xterm` + addons | Terminal emulator |
| `marked` + `marked-highlight` | Markdown rendering |
| `highlight.js` | Code syntax highlighting |
| `lucide-react` | Icons |
| `vite` | Build tool |
| `typescript` | Type checking |

### C++ Kernel (build-time)

`cmake`, `g++`, `python3-dev`, `pybind11-dev`

## Setup & Run

### Prerequisites

- Docker (recommended), **or**
- Python 3.10+, Node 20+, CMake 3.18+, g++ (manual)
- A [Gemini API key](https://aistudio.google.com/apikey)

### Docker (one command)

```bash
# Create .env with your API key
echo "GEMINI_API_KEY=your-key-here" > .env

# Build and run
docker build -t muchovhaos .
docker run -d --name muchovhaos --restart unless-stopped \
  --env-file .env --privileged -p 80:8000 muchovhaos
```

Open `http://localhost` in your browser.

### Cloud Deploy (Azure/AWS)

```bash
# Azure VM or any Ubuntu server — clone the repo, then:
chmod +x deploy.sh && ./deploy.sh

# AWS (launches an EC2 instance automatically):
chmod +x aws-deploy.sh && ./aws-deploy.sh
```

### Local Development (no Docker)

```bash
# 1. Build the C++ kernel
cd kernel && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)
cp build/agent_kernel*.so $(python3 -c "import site; print(site.getsitepackages()[0])")/
cd ..

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Build the frontend
cd frontend && npm install && npm run build
cp -r dist/ ../app/static/
cd ..

# 4. Set your API key and run
export GEMINI_API_KEY="your-key-here"
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`.

### Frontend Dev Server (hot reload)

```bash
cd frontend && npm run dev
```

Vite serves on `http://localhost:5173` and proxies API calls to the backend.

## Useful Commands

```bash
docker logs -f muchovhaos     # View logs
docker restart muchovhaos     # Restart
docker exec -it muchovhaos bash  # Shell into container
```
