"""
FastAPI backend — serves the React UI, bridges terminal PTY and Gemini AI.

Route layout:
    GET  /                       → React SPA
    WS   /ws/terminal            → PTY WebSocket
    POST /api/chat               → AI chat (guided / autopilot)
    POST /api/chat/multimodal    → AI chat with images/audio attachments
    POST /api/shellmate          → AI chat (terminal / shellmate mode, structured output)
    POST /api/explain-error      → One-shot error explanation
    POST /api/suggest            → One-shot command suggestion
    GET  /api/health             → Liveness probe
    GET  /api/sessions           → Diagnostic: list active AI sessions
    POST /api/sessions/clear     → Clear a session's history
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .ai import AIAssistant
from .config import config
from .history import MediaAttachment
from .terminal import TerminalManager

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="LinuxMentor — AI-Powered Linux Learning")
terminal_mgr = TerminalManager()
ai = AIAssistant()


# ═══════════════════════════════════════════════════════════════════════════
# Static UI (built React app)
# ═══════════════════════════════════════════════════════════════════════════

STATIC_DIR = config.server.static_dir

if os.path.isdir(os.path.join(STATIC_DIR, "assets")):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(STATIC_DIR, "assets")),
        name="assets",
    )


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ═══════════════════════════════════════════════════════════════════════════
# Terminal WebSocket
# ═══════════════════════════════════════════════════════════════════════════


@app.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid.uuid4())
    terminal_mgr.create_session(session_id)

    await websocket.send_text(json.dumps({"type": "session", "id": session_id}))

    async def pty_reader():
        """Continuously read PTY output and push to browser."""
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
                payload = json.loads(msg["text"])
                msg_type = payload.get("type")
                if msg_type == "resize":
                    terminal_mgr.resize(session_id, payload["cols"], payload["rows"])
                elif msg_type == "get_history":
                    history = terminal_mgr.get_history(session_id)
                    await websocket.send_text(
                        json.dumps({"type": "history", "data": history})
                    )
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: %s", session_id)
    except Exception:
        logger.exception("WebSocket error: %s", session_id)
    finally:
        reader_task.cancel()
        terminal_mgr.close_session(session_id)
        ai.remove_session(session_id)


# ═══════════════════════════════════════════════════════════════════════════
# Request / response schemas
# ═══════════════════════════════════════════════════════════════════════════


class ChatRequest(BaseModel):
    """Payload for the main chat and shellmate endpoints."""

    message: str
    terminal_context: str = ""
    session_id: str = "default"
    mode: str = Field(default="guided", pattern="^(guided|autopilot|terminal)$")


class SuggestRequest(BaseModel):
    """Payload for one-shot command suggestion."""

    task: str


class SessionActionRequest(BaseModel):
    """Payload for session management actions."""

    session_id: str


# ═══════════════════════════════════════════════════════════════════════════
# AI Chat endpoints
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        response = await ai.chat(
            session_id=req.session_id,
            user_message=req.message,
            terminal_context=req.terminal_context,
            mode=req.mode,
        )
        return JSONResponse({"response": response})
    except Exception as e:
        logger.exception("Chat error (session=%s)", req.session_id)
        return JSONResponse({"error": str(e)}, status_code=500)


# ═══════════════════════════════════════════════════════════════════════════
# Multimodal chat (images, audio, screenshots)
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/api/chat/multimodal")
async def chat_multimodal(
    message: str = Form(default=""),
    terminal_context: str = Form(default=""),
    session_id: str = Form(default="default"),
    mode: str = Form(default="guided"),
    files: list[UploadFile] = File(default=[]),
):
    """
    Multimodal chat endpoint — accepts text + file uploads (images, audio).

    Files are read into memory, base64-encoded, and sent to Gemini as
    inline_data parts alongside the user's text message.
    """
    try:
        mm_config = config.multimodal
        attachments: list[MediaAttachment] = []

        for upload in files:
            content_type = upload.content_type or "application/octet-stream"

            # Validate MIME type
            if content_type not in mm_config.all_supported_types:
                return JSONResponse(
                    {"error": f"Unsupported file type: {content_type}. "
                     f"Supported: {', '.join(mm_config.all_supported_types)}"},
                    status_code=400,
                )

            # Read and check size
            data = await upload.read()
            is_image = content_type.startswith("image/")
            max_bytes = mm_config.max_image_bytes if is_image else mm_config.max_audio_bytes
            max_label = f"{mm_config.max_image_size_mb}MB" if is_image else f"{mm_config.max_audio_size_mb}MB"

            if len(data) > max_bytes:
                return JSONResponse(
                    {"error": f"File too large ({len(data) / 1024 / 1024:.1f}MB). "
                     f"Maximum for {'images' if is_image else 'audio'}: {max_label}"},
                    status_code=400,
                )

            # Determine label
            label = "screenshot" if is_image else "voice note"
            if upload.filename:
                label = upload.filename

            encoded = base64.standard_b64encode(data).decode("ascii")
            attachments.append(MediaAttachment(
                mime_type=content_type,
                data=encoded,
                label=label,
            ))

        # Default message when only media is sent
        if not message.strip() and attachments:
            if all(a.is_image for a in attachments):
                message = "What do you see in this image? Analyze it in the context of my terminal session."
            elif all(a.is_audio for a in attachments):
                message = "Listen to my voice message and respond."
            else:
                message = "Analyze these attachments and help me."

        logger.info(
            "Multimodal chat (session=%s): text=%d chars, attachments=%d [%s]",
            session_id,
            len(message),
            len(attachments),
            ", ".join(a.mime_type for a in attachments),
        )

        response = await ai.chat(
            session_id=session_id,
            user_message=message,
            terminal_context=terminal_context,
            mode=mode,
            attachments=attachments,
        )
        return JSONResponse({"response": response})

    except Exception as e:
        logger.exception("Multimodal chat error (session=%s)", session_id)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/shellmate")
async def shellmate(req: ChatRequest):
    """
    Shellmate endpoint — forces terminal mode and returns structured segments
    the frontend can render with ANSI styling in the terminal.
    """
    try:
        raw = await ai.chat(
            session_id=req.session_id,
            user_message=req.message,
            terminal_context=req.terminal_context,
            mode="terminal",
        )
        segments = _parse_shellmate_segments(raw)
        return JSONResponse({"segments": segments, "raw": raw})
    except Exception as e:
        logger.exception("Shellmate error (session=%s)", req.session_id)
        return JSONResponse({"error": str(e)}, status_code=500)


def _parse_shellmate_segments(raw: str) -> list[dict[str, str]]:
    """
    Parse the AI's structured shellmate response into typed segments.

    Expected line prefixes from the AI:
        CMD:  → executable command
        WARN: → warning text
        (anything else) → explanatory text
    """
    segments: list[dict[str, str]] = []
    for line in raw.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.upper().startswith("CMD:"):
            cmd = stripped[4:].strip()
            if cmd:
                segments.append({"type": "command", "text": cmd})
        elif stripped.upper().startswith("WARN:"):
            warn = stripped[5:].strip()
            if warn:
                segments.append({"type": "warning", "text": warn})
        else:
            segments.append({"type": "text", "text": stripped})
    return segments


# ═══════════════════════════════════════════════════════════════════════════
# Stateless AI helpers
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/api/explain-error")
async def explain_error(req: ChatRequest):
    try:
        response = await ai.explain_error(req.terminal_context)
        return JSONResponse({"response": response})
    except Exception as e:
        logger.exception("Explain-error failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/suggest")
async def suggest(req: SuggestRequest):
    try:
        response = await ai.suggest_command(req.task)
        return JSONResponse({"response": response})
    except Exception as e:
        logger.exception("Suggest failed")
        return JSONResponse({"error": str(e)}, status_code=500)


# ═══════════════════════════════════════════════════════════════════════════
# Session management & diagnostics
# ═══════════════════════════════════════════════════════════════════════════


@app.get("/api/sessions")
async def list_sessions():
    """List all active AI conversation sessions (for debugging)."""
    return JSONResponse({
        "sessions": ai.list_sessions(),
        "terminal_count": terminal_mgr.active_count,
    })


@app.post("/api/sessions/clear")
async def clear_session(req: SessionActionRequest):
    """Clear conversation history for a specific session."""
    ai.clear_session(req.session_id)
    return JSONResponse({"status": "cleared", "session_id": req.session_id})


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "LinuxMentor",
        "active_sessions": terminal_mgr.active_count,
    }
