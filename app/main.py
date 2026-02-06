"""
FastAPI backend — serves the React UI, bridges terminal PTY and Gemini AI.
"""

import asyncio
import json
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ai import AIAssistant
from .terminal import TerminalManager

load_dotenv()

app = FastAPI(title="LinuxMentor — AI-Powered Linux Learning")
terminal_mgr = TerminalManager()
ai = AIAssistant()


# ── Static UI (built React app) ────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# Serve Vite assets
if os.path.isdir(os.path.join(STATIC_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ── Terminal WebSocket ──────────────────────────────────────────────────────

@app.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid.uuid4())
    terminal_mgr.create_session(session_id)

    # Store session_id on the websocket so the chat endpoint can find it
    await websocket.send_text(json.dumps({"type": "session", "id": session_id}))

    async def pty_reader():
        """Continuously read PTY output and push to browser."""
        while True:
            await asyncio.sleep(0.02)  # 50 fps max
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
                    terminal_mgr.resize(
                        session_id, payload["cols"], payload["rows"]
                    )
                elif msg_type == "get_history":
                    history = terminal_mgr.get_history(session_id)
                    await websocket.send_text(
                        json.dumps({"type": "history", "data": history})
                    )
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        reader_task.cancel()
        terminal_mgr.close_session(session_id)


# ── AI Chat REST API ───────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    terminal_context: str = ""
    session_id: str = "default"


@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        response = await ai.chat(
            session_id=req.session_id,
            user_message=req.message,
            terminal_context=req.terminal_context,
        )
        return JSONResponse({"response": response})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/explain-error")
async def explain_error(req: ChatRequest):
    try:
        response = await ai.explain_error(req.terminal_context)
        return JSONResponse({"response": response})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


class SuggestRequest(BaseModel):
    task: str


@app.post("/api/suggest")
async def suggest(req: SuggestRequest):
    try:
        response = await ai.suggest_command(req.task)
        return JSONResponse({"response": response})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "LinuxMentor"}
