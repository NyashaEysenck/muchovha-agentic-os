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
    GET  /api/monitor/status     → Health monitor status
    GET  /api/monitor/alerts     → Alert history
    POST /api/monitor/toggle     → Toggle monitoring on/off
    POST /api/monitor/autoheal   → Toggle auto-heal on/off
    POST /api/monitor/dismiss    → Dismiss an alert
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
from .monitor import HealthMonitor
from .terminal import TerminalManager

load_dotenv()

# Import kernel once at module level
try:
    import agent_kernel  # type: ignore
except ImportError:
    agent_kernel = None  # type: ignore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(name)s %(message)s")
logger = logging.getLogger(__name__)

# ── Initialize core components ───────────────────────────────────────────

tools = ToolRegistry()
for tool in create_builtin_tools():
    tools.register(tool)

skills = SkillEngine()
agent = AgentLoop(tools, skills)
terminal_mgr = TerminalManager()
monitor = HealthMonitor()

# In-memory attachment store (attachment_id → (Attachment, upload_time))
_uploads: dict[str, tuple[Attachment, float]] = {}
_UPLOAD_TTL = 300.0  # 5 minutes

def _cleanup_uploads() -> None:
    """Remove uploads older than TTL."""
    import time
    now = time.time()
    expired = [k for k, (_, ts) in _uploads.items() if now - ts > _UPLOAD_TTL]
    for k in expired:
        _uploads.pop(k, None)

# ── Auto-heal callback: runs agent on the default session so user sees it ──

async def _auto_heal_callback(goal: str) -> str:
    """Run the agent loop for auto-heal and stream events to the default session."""
    parts: list[str] = []
    async for event in agent.run(f"[AUTO-HEAL] {goal}", session_id="default"):
        if event.type.value == "text":
            parts.append(event.data.get("text", ""))
    return "\n".join(parts)

monitor.set_agent_callback(_auto_heal_callback)

# ── FastAPI app ──────────────────────────────────────────────────────────

app = FastAPI(title="AgentOS")

# Static frontend
STATIC_DIR = config.server.static_dir
if os.path.isdir(os.path.join(STATIC_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")


@app.on_event("startup")
async def on_startup():
    monitor.start()
    logger.info("HealthMonitor background task started")


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

    import time as _time
    _cleanup_uploads()  # evict stale uploads on each new upload
    attachment_id = str(uuid.uuid4())
    _uploads[attachment_id] = (Attachment(
        mime_type=content_type,
        data=data,
        name=file.filename or "upload",
    ), _time.time())

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
        entry = _uploads.pop(aid, None)  # consume on use
        if entry:
            attachments.append(entry[0])

    async def event_stream():
        async for event in agent.run(req.goal, req.session_id, attachments=attachments or None):
            yield event.to_sse()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Agent stop endpoint ──────────────────────────────────────────────


class StopRequest(BaseModel):
    session_id: str = "default"


@app.post("/api/agent/stop")
async def agent_stop(req: StopRequest):
    """Cancel a running agent loop."""
    agent.cancel(req.session_id)
    return JSONResponse({"stopped": True, "session_id": req.session_id})


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


# ── Health Monitor endpoints ────────────────────────────────────────────


@app.get("/api/monitor/status")
async def monitor_status():
    """Get health monitor status and active alerts."""
    alerts = monitor.get_active_alerts()
    worst = "ok"
    for a in alerts:
        if a["severity"] == "critical":
            worst = "critical"
            break
        if a["severity"] == "warning":
            worst = "warning"
    return JSONResponse({
        "enabled": monitor.enabled,
        "auto_heal": monitor.auto_heal,
        "status": worst,
        "active_alerts": len(alerts),
        "total_alerts": len(monitor.alerts),
        "check_interval": monitor.check_interval,
        "alerts": alerts,
    })


@app.get("/api/monitor/alerts")
async def monitor_alerts():
    """Get full alert history."""
    return JSONResponse({"alerts": monitor.get_alert_history()})


@app.post("/api/monitor/toggle")
async def monitor_toggle():
    """Toggle the health monitor on/off."""
    monitor.enabled = not monitor.enabled
    logger.info("HealthMonitor toggled to %s", monitor.enabled)
    return JSONResponse({"enabled": monitor.enabled})


@app.post("/api/monitor/autoheal")
async def monitor_autoheal():
    """Toggle auto-heal mode on/off."""
    monitor.auto_heal = not monitor.auto_heal
    logger.info("Auto-heal toggled to %s", monitor.auto_heal)
    return JSONResponse({"auto_heal": monitor.auto_heal})


class DismissRequest(BaseModel):
    alert_id: str


@app.post("/api/monitor/dismiss")
async def monitor_dismiss(req: DismissRequest):
    """Dismiss an alert by ID."""
    ok = monitor.dismiss_alert(req.alert_id)
    if not ok:
        return JSONResponse({"error": "Alert not found"}, status_code=404)
    return JSONResponse({"dismissed": True})


# ── System endpoints ────────────────────────────────────────────────────


@app.get("/api/system/metrics")
async def system_metrics():
    if agent_kernel is None:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)
    loop = asyncio.get_running_loop()
    cpu, mem, disk = await asyncio.gather(
        loop.run_in_executor(None, agent_kernel.SystemMetrics.cpu),
        loop.run_in_executor(None, agent_kernel.SystemMetrics.memory),
        loop.run_in_executor(None, lambda: agent_kernel.SystemMetrics.disk("/")),
    )
    return JSONResponse({
        "cpu": {"usage_percent": round(cpu.usage_percent, 1), "cores": cpu.core_count,
                "load": [round(cpu.load_1m, 2), round(cpu.load_5m, 2), round(cpu.load_15m, 2)]},
        "memory": {"total_mb": mem.total_kb // 1024, "used_mb": mem.used_kb // 1024,
                   "available_mb": mem.available_kb // 1024, "usage_percent": round(mem.usage_percent, 1)},
        "disk": {"total_gb": round(disk.total_bytes / 1e9, 1), "used_gb": round(disk.used_bytes / 1e9, 1),
                 "available_gb": round(disk.available_bytes / 1e9, 1), "usage_percent": round(disk.usage_percent, 1)},
    })


@app.get("/api/system/processes")
async def system_processes():
    if agent_kernel is None:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)
    loop = asyncio.get_running_loop()
    procs = await loop.run_in_executor(None, agent_kernel.ProcessManager.list_all)
    sorted_procs = sorted(procs, key=lambda p: p.rss_kb, reverse=True)[:50]
    return JSONResponse({
        "processes": [
            {"pid": p.pid, "name": p.name, "state": p.state,
             "rss_mb": round(p.rss_kb / 1024, 1), "cmdline": p.cmdline[:200]}
            for p in sorted_procs
        ]
    })


# ── Network endpoints ────────────────────────────────────────────────


@app.get("/api/system/network")
async def system_network():
    if agent_kernel is None:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)
    loop = asyncio.get_running_loop()
    tcp, tcp6, ifaces, listening = await asyncio.gather(
        loop.run_in_executor(None, lambda: agent_kernel.NetworkMonitor.connections("tcp")),
        loop.run_in_executor(None, lambda: agent_kernel.NetworkMonitor.connections("tcp6")),
        loop.run_in_executor(None, agent_kernel.NetworkMonitor.interfaces),
        loop.run_in_executor(None, agent_kernel.NetworkMonitor.listening_ports),
    )
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


@app.get("/api/system/container")
async def system_container():
    if agent_kernel is None:
        return JSONResponse({"error": "C++ kernel not available"}, status_code=503)
    loop = asyncio.get_running_loop()
    cg = await loop.run_in_executor(None, agent_kernel.CgroupManager.info)
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
