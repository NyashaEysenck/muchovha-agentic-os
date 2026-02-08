"""
AgentOS — FastAPI backend with SSE agent streaming, PTY terminal, and FastMCP.

Endpoints:
    GET  /                       → React SPA
    WS   /ws/terminal            → PTY WebSocket
    POST /api/agent/run          → Agent loop (SSE stream)
    POST /api/upload             → Upload files (images, audio) for agent
    GET  /api/skills             → List discovered skills
    POST /api/skills/{name}/activate   → Activate a skill
    POST /api/skills/{name}/deactivate → Deactivate a skill
    GET  /api/thinking           → Get thinking mode status
    POST /api/thinking/toggle    → Toggle thinking mode on/off
    GET  /api/system/metrics     → System metrics (CPU, memory, disk)
    GET  /api/system/processes   → Process list
    GET  /api/system/network     → Network connections + interfaces
    GET  /api/system/container   → Container/cgroup information
    GET  /api/sessions           → Active agent sessions
    GET  /api/health             → Liveness probe
    /mcp                         → FastMCP server (MCP protocol)
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .agent.loop import AgentLoop, Attachment
from .agent.tools import ToolRegistry, create_builtin_tools
from .agent.skills import SkillEngine
from .config import config
from .terminal import TerminalManager

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(name)s %(message)s")
logger = logging.getLogger(__name__)

# ── Initialize core components ───────────────────────────────────────────

tools = ToolRegistry()
for tool in create_builtin_tools():
    tools.register(tool)

skills = SkillEngine()
agent = AgentLoop(tools, skills)
terminal_mgr = TerminalManager()

# In-memory attachment store (attachment_id → Attachment)
_uploads: dict[str, Attachment] = {}

# ── FastAPI app ──────────────────────────────────────────────────────────

app = FastAPI(title="AgentOS")

# Static frontend
STATIC_DIR = config.server.static_dir
if os.path.isdir(os.path.join(STATIC_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ── FastMCP mount ────────────────────────────────────────────────────────

try:
    from .mcp.server import mcp as mcp_server
    mcp_app = mcp_server.http_app(path="/")
    app.mount("/mcp", mcp_app)
    logger.info("FastMCP server mounted at /mcp")
except Exception:
    logger.warning("Failed to mount FastMCP server", exc_info=True)


# ── Terminal WebSocket ───────────────────────────────────────────────────


@app.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid.uuid4())
    terminal_mgr.create_session(session_id)
    await websocket.send_text(json.dumps({"type": "session", "id": session_id}))

    async def pty_reader():
        while True:
            await asyncio.sleep(config.server.pty_poll_interval)
            if not terminal_mgr.is_alive(session_id):
                break
            data = terminal_mgr.read(session_id)
            if data:
                try:
                    await websocket.send_bytes(data)
                except Exception:
                    break

    reader_task = asyncio.create_task(pty_reader())
    try:
        while True:
            msg = await websocket.receive()
            if "bytes" in msg:
                terminal_mgr.write(session_id, msg["bytes"])
            elif "text" in msg:
                try:
                    payload = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if payload.get("type") == "resize":
                    terminal_mgr.resize(session_id, payload.get("cols", 80), payload.get("rows", 24))
                elif payload.get("type") == "get_history":
                    history = terminal_mgr.get_history(session_id)
                    await websocket.send_text(json.dumps({"type": "history", "data": history}))
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error: %s", session_id)
    finally:
        reader_task.cancel()
        terminal_mgr.close_session(session_id)
        agent.remove_session(session_id)


# ── File upload endpoint ─────────────────────────────────────────────────

ALLOWED_MIME_PREFIXES = ("image/", "audio/")


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload an image or audio file for the agent. Returns an attachment ID."""
    content_type = file.content_type or ""
    if not any(content_type.startswith(p) for p in ALLOWED_MIME_PREFIXES):
        return JSONResponse(
            {"error": f"Unsupported file type: {content_type}. Only images and audio are accepted."},
            status_code=400,
        )

    data = await file.read()
    if len(data) > config.server.max_upload_bytes:
        return JSONResponse(
            {"error": f"File too large ({len(data)} bytes). Max is {config.server.max_upload_bytes} bytes."},
            status_code=413,
        )

    attachment_id = str(uuid.uuid4())
    _uploads[attachment_id] = Attachment(
        mime_type=content_type,
        data=data,
        name=file.filename or "upload",
    )

    logger.info("Uploaded %s (%s, %d bytes) → %s", file.filename, content_type, len(data), attachment_id)

    return JSONResponse({
        "id": attachment_id,
        "name": file.filename,
        "mime_type": content_type,
        "size": len(data),
    })


# ── Agent endpoint (SSE) ────────────────────────────────────────────────


class AgentRequest(BaseModel):
    goal: str
    session_id: str = "default"
    attachment_ids: list[str] = []


@app.post("/api/agent/run")
async def agent_run(req: AgentRequest):
    """Run the agent loop and stream events via SSE."""

    # Resolve attachments from the upload store
    attachments: list[Attachment] = []
    for aid in req.attachment_ids:
        att = _uploads.pop(aid, None)  # consume on use
        if att:
            attachments.append(att)

    async def event_stream():
        async for event in agent.run(req.goal, req.session_id, attachments=attachments or None):
            yield event.to_sse()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Skills endpoints ────────────────────────────────────────────────────


@app.get("/api/skills")
async def list_skills():
    return JSONResponse({
        "skills": [
            {
                "name": s.name,
                "description": s.description,
                "path": str(s.path),
                "active": skills.is_active(s.name),
            }
            for s in skills.list_skills()
        ]
    })


@app.post("/api/skills/{name}/activate")
async def activate_skill(name: str):
    ctx = skills.activate(name)
    if not ctx:
        return JSONResponse({"error": f"Skill '{name}' not found"}, status_code=404)
    return JSONResponse({
        "name": ctx.meta.name,
        "active": True,
        "scripts": ctx.scripts,
        "references": ctx.references,
    })


@app.post("/api/skills/{name}/deactivate")
async def deactivate_skill(name: str):
    skills.deactivate(name)
    return JSONResponse({"name": name, "active": False})


# ── Thinking mode toggle ────────────────────────────────────────────


@app.get("/api/thinking")
async def get_thinking():
    """Get current thinking mode status."""
    return JSONResponse({"enabled": agent.thinking_enabled})


@app.post("/api/thinking/toggle")
async def toggle_thinking():
    """Toggle thinking mode on/off."""
    agent.thinking_enabled = not agent.thinking_enabled
    logger.info("Thinking mode toggled to %s", agent.thinking_enabled)
    return JSONResponse({"enabled": agent.thinking_enabled})


# ── System endpoints ────────────────────────────────────────────────────


@app.get("/api/system/metrics")
async def system_metrics():
    try:
        import agent_kernel  # type: ignore
        cpu = agent_kernel.SystemMetrics.cpu()
        mem = agent_kernel.SystemMetrics.memory()
        disk = agent_kernel.SystemMetrics.disk("/")
        return JSONResponse({
            "cpu": {"usage_percent": round(cpu.usage_percent, 1), "cores": cpu.core_count,
                    "load": [round(cpu.load_1m, 2), round(cpu.load_5m, 2), round(cpu.load_15m, 2)]},
            "memory": {"total_mb": mem.total_kb // 1024, "used_mb": mem.used_kb // 1024,
                       "available_mb": mem.available_kb // 1024, "usage_percent": round(mem.usage_percent, 1)},
            "disk": {"total_gb": round(disk.total_bytes / 1e9, 1), "used_gb": round(disk.used_bytes / 1e9, 1),
                     "available_gb": round(disk.available_bytes / 1e9, 1), "usage_percent": round(disk.usage_percent, 1)},
        })
    except ImportError:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)


@app.get("/api/system/processes")
async def system_processes():
    try:
        import agent_kernel  # type: ignore
        procs = agent_kernel.ProcessManager.list_all()
        sorted_procs = sorted(procs, key=lambda p: p.rss_kb, reverse=True)[:50]
        return JSONResponse({
            "processes": [
                {"pid": p.pid, "name": p.name, "state": p.state,
                 "rss_mb": round(p.rss_kb / 1024, 1), "cmdline": p.cmdline[:200]}
                for p in sorted_procs
            ]
        })
    except ImportError:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)


# ── Network endpoints ────────────────────────────────────────────────


@app.get("/api/system/network")
async def system_network():
    try:
        import agent_kernel  # type: ignore
        tcp = agent_kernel.NetworkMonitor.connections("tcp")
        tcp6 = agent_kernel.NetworkMonitor.connections("tcp6")
        ifaces = agent_kernel.NetworkMonitor.interfaces()
        listening = agent_kernel.NetworkMonitor.listening_ports()
        return JSONResponse({
            "connections": {
                "tcp": len(tcp),
                "tcp6": len(tcp6),
                "established": sum(1 for c in tcp + tcp6 if c.state == "ESTABLISHED"),
            },
            "listening": [
                {"protocol": p.protocol, "address": p.local_addr, "port": p.local_port}
                for p in listening
            ],
            "interfaces": [
                {"name": i.name, "rx_mb": round(i.rx_bytes / 1e6, 2),
                 "tx_mb": round(i.tx_bytes / 1e6, 2),
                 "rx_errors": i.rx_errors, "tx_errors": i.tx_errors}
                for i in ifaces
            ],
        })
    except ImportError:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)


@app.get("/api/system/container")
async def system_container():
    try:
        import agent_kernel  # type: ignore
        cg = agent_kernel.CgroupManager.info()
        return JSONResponse({
            "is_containerized": cg.is_containerized,
            "cgroup_version": cg.cgroup_version,
            "memory": {
                "limit_mb": round(cg.memory_limit_bytes / 1e6, 1) if cg.memory_limit_bytes > 0 else None,
                "usage_mb": round(cg.memory_usage_bytes / 1e6, 1) if cg.memory_usage_bytes > 0 else None,
            },
            "cpu": {
                "quota_cores": round(cg.cpu_quota, 2) if cg.cpu_quota > 0 else None,
            },
            "pids": {
                "limit": cg.pids_limit if cg.pids_limit > 0 else None,
                "current": cg.pids_current if cg.pids_current > 0 else None,
            },
        })
    except ImportError:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)


# ── Session management ──────────────────────────────────────────────────


@app.get("/api/sessions")
async def list_sessions():
    return JSONResponse({
        "sessions": agent.list_sessions(),
        "terminal_count": terminal_mgr.active_count,
    })


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "AgentOS", "tools": tools.count, "skills": len(skills.list_skills())}
