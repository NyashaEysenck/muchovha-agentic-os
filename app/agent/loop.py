"""
ReAct agent loop using Gemini 3 function calling with thinking mode.

The loop: Prompt → Model thinks + responds (text or tool_call) → Execute tool →
Feed result back → Repeat until model responds with text (no tool calls).

Key Gemini 3 features leveraged:
  - Thinking mode with include_thoughts=True → streams the model's reasoning
  - Thought signatures preserved on function_call parts for multi-turn
  - Multimodal input (images, audio) via Part.from_bytes
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator

from google import genai
from google.genai import types as genai_types

from ..config import config
from .tools import ToolRegistry
from .skills import SkillEngine

logger = logging.getLogger(__name__)


# ── Attachment type for multimodal input ──────────────────────────────────


@dataclass
class Attachment:
    """A file attached to an agent request (image, audio, etc.)."""
    mime_type: str   # e.g. "image/png", "audio/webm"
    data: bytes      # raw file bytes
    name: str = ""   # original filename


# ── Event types streamed to the frontend ─────────────────────────────────


class EventType(str, Enum):
    STATUS = "status"
    THOUGHT = "thought"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    TEXT = "text"
    ERROR = "error"
    DONE = "done"


@dataclass
class AgentEvent:
    type: EventType
    data: dict[str, Any] = field(default_factory=dict)

    def to_sse(self) -> str:
        return f"event: {self.type.value}\ndata: {json.dumps(self.data)}\n\n"


# ── Conversation history ─────────────────────────────────────────────────


class Session:
    """Conversation state for a single agent session.

    Stores raw genai_types.Content objects so thought_signature fields
    are preserved across turns (required by Gemini 3).
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.messages: list[Any] = []
        self.created_at = time.time()

    def add_user_content(self, parts: list[Any]) -> None:
        """Add a user message with one or more parts (text, image, audio)."""
        self.messages.append(genai_types.Content(role="user", parts=parts))

    def add_model_content(self, content: Any) -> None:
        """Store the model's raw Content response, preserving thought_signature."""
        self.messages.append(content)

    def add_function_responses(self, responses: list[tuple[str, dict]]) -> None:
        """Add all function responses for this iteration as a single user turn."""
        parts = []
        for name, response in responses:
            parts.append(genai_types.Part(
                function_response=genai_types.FunctionResponse(
                    name=name,
                    response=response,
                ),
            ))
        self.messages.append(genai_types.Content(role="user", parts=parts))

    def to_contents(self) -> list[Any]:
        """Return messages as-is — the SDK handles serialisation of Content objects."""
        return list(self.messages)

    def trim(self, max_turns: int) -> None:
        """Keep the last N messages to prevent context overflow."""
        if len(self.messages) > max_turns * 2:
            self.messages = self.messages[-(max_turns * 2):]

    @property
    def turn_count(self) -> int:
        return len(self.messages)


# ── System prompt ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are **MuchovhaOS** — an autonomous AI agent embedded in a live Linux operating system.

You have direct access to the system through tools. You can execute commands,
read and write files, inspect processes, monitor resources, and observe the network.

CAPABILITIES:
- Execute any shell command via `execute_command` (sandboxed with resource limits)
- Read and write files anywhere on the filesystem
- List directory contents and fast recursive file search via `search_files`
- Read the last N lines of large files efficiently via `tail_file`
- Monitor CPU, memory, disk, and running processes via `system_info` and `process_list`
- View the process tree with parent-child hierarchy via `process_tree`
- Inspect network connections, listening ports, and interface stats via `network_connections`, `listening_ports`, `network_interfaces`
- Detect container environment and cgroup limits via `container_info`
- Access specialized skills for domain-specific tasks
- Analyze images, screenshots, and audio provided by the user

BEHAVIOR:
1. When given a goal, break it into steps and execute them using your tools.
2. After each tool call, analyze the result before deciding the next action.
3. If a command fails, diagnose the error and try an alternative approach.
4. Be concise in your explanations. Show what you did and why.
5. For destructive operations (rm, format, etc.), explain the risk first.
6. Use system_info, container_info, or network tools to understand the environment.
7. When the user provides images or screenshots, analyze them carefully.
8. When the user provides audio, transcribe and respond to the content.
9. When triggered by the health monitor (auto-heal), diagnose the anomaly, identify root cause, and take corrective action autonomously.

OUTPUT:
- When you've completed the task, respond with a summary of what was done.
- Include relevant output snippets from commands.
- If you can't complete the task, explain why and suggest alternatives.
"""


# ── Agent loop ───────────────────────────────────────────────────────────


class AgentLoop:
    """
    ReAct agent loop powered by Gemini 3 function calling with thinking mode.

    Usage:
        loop = AgentLoop(tools, skills)
        async for event in loop.run("Install nginx", session_id):
            # stream event to frontend
    """

    def __init__(self, tools: ToolRegistry, skills: SkillEngine) -> None:
        self._client = genai.Client(api_key=config.ai.api_key)
        self._model = config.ai.model
        self._tools = tools
        self._skills = skills
        self._sessions: dict[str, Session] = {}
        self._cancelled: set[str] = set()  # session IDs with pending cancel
        self.thinking_enabled: bool = True

    def cancel(self, session_id: str) -> None:
        """Request cancellation for a running session."""
        self._cancelled.add(session_id)
        logger.info("Cancel requested for session %s", session_id)

    def get_session(self, session_id: str) -> Session:
        if session_id not in self._sessions:
            self._sessions[session_id] = Session(session_id)
        return self._sessions[session_id]

    def remove_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._cancelled.discard(session_id)

    def list_sessions(self) -> list[dict]:
        return [
            {"session_id": s.session_id, "turns": s.turn_count, "created_at": s.created_at}
            for s in self._sessions.values()
        ]

    async def run(
        self,
        goal: str,
        session_id: str,
        attachments: list[Attachment] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """Execute the agent loop. Yields events for SSE streaming."""
        session = self.get_session(session_id)

        # ── Build user message with optional multimodal parts ────────
        user_text = goal
        active_ctx = self._skills.active_skills_context()
        if active_ctx:
            user_text = f"{active_ctx}\n\n{goal}" if goal else active_ctx

        user_parts: list[Any] = []
        if user_text:
            user_parts.append(genai_types.Part(text=user_text))

        if attachments:
            for att in attachments:
                user_parts.append(
                    genai_types.Part.from_bytes(data=att.data, mime_type=att.mime_type)
                )
                logger.info("Attached %s (%s, %d bytes)", att.name, att.mime_type, len(att.data))

        # Ensure at least one part exists for the API call
        if not user_parts:
            user_parts.append(genai_types.Part(text=""))

        session.add_user_content(user_parts)
        session.trim(config.ai.max_history_turns)

        yield AgentEvent(EventType.STATUS, {"status": "thinking"})

        iterations = 0
        max_iter = config.ai.max_agent_iterations

        # ── Pre-compute immutable data for this run ──────────────────
        system_prompt = SYSTEM_PROMPT
        skills_xml = self._skills.to_prompt_xml()
        if skills_xml:
            system_prompt += f"\n\n{skills_xml}"

        gemini_tools = self._tools.to_gemini_tools()
        gen_config = genai_types.GenerateContentConfig(
            tools=gemini_tools,
            temperature=0.3,
            thinking_config=genai_types.ThinkingConfig(include_thoughts=True) if self.thinking_enabled else None,
        )

        # Build system prompt prefix once
        sys_prefix = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=system_prompt)],
            ),
            genai_types.Content(
                role="model",
                parts=[genai_types.Part(text="Ready. I have access to the system tools and skills. What would you like me to do?")],
            ),
        ]

        while iterations < max_iter:
            # ── Check for cancellation ────────────────────────────
            if session_id in self._cancelled:
                self._cancelled.discard(session_id)
                yield AgentEvent(EventType.TEXT, {"text": "Agent stopped by user."})
                yield AgentEvent(EventType.DONE, {})
                return

            iterations += 1

            # ── Call Gemini with tools + optional thinking mode ─────────
            try:
                contents = sys_prefix + session.to_contents()
                response = await self._client.aio.models.generate_content(
                    model=self._model,
                    contents=contents,
                    config=gen_config,
                )
            except Exception as e:
                logger.exception("Gemini API error")
                yield AgentEvent(EventType.ERROR, {"error": str(e)})
                return

            # Process the response
            if not response.candidates:
                yield AgentEvent(EventType.ERROR, {"error": "No response from model"})
                return

            candidate = response.candidates[0]

            # ── Store model content as-is (preserves thought_signature) ──
            session.add_model_content(candidate.content)

            # ── Log token usage ──────────────────────────────────────
            if response.usage_metadata:
                meta = response.usage_metadata
                thoughts_tokens = getattr(meta, "thoughts_token_count", 0) or 0
                logger.info(
                    "Tokens — input: %s, output: %s, thinking: %s",
                    getattr(meta, "prompt_token_count", "?"),
                    getattr(meta, "candidates_token_count", "?"),
                    thoughts_tokens,
                )

            has_tool_calls = False
            text_parts: list[str] = []
            thought_parts: list[str] = []
            function_responses: list[tuple[str, dict]] = []

            for part in candidate.content.parts:
                # ── Thought summaries from Gemini 3 thinking ─────────
                if getattr(part, "thought", False) and part.text:
                    thought_parts.append(part.text)

                # ── Function calls ───────────────────────────────────
                elif hasattr(part, "function_call") and part.function_call:
                    has_tool_calls = True
                    fc = part.function_call
                    call_name = fc.name
                    call_args = dict(fc.args) if fc.args else {}

                    yield AgentEvent(EventType.TOOL_CALL, {
                        "tool": call_name,
                        "args": call_args,
                    })

                    # Check cancel before running tool
                    if session_id in self._cancelled:
                        self._cancelled.discard(session_id)
                        yield AgentEvent(EventType.TEXT, {"text": "Agent stopped by user."})
                        yield AgentEvent(EventType.DONE, {})
                        return

                    # Execute the tool
                    result_str = await self._tools.execute(call_name, call_args)

                    # Truncate very long results
                    if len(result_str) > 8000:
                        result_str = result_str[:8000] + "\n... (truncated)"

                    yield AgentEvent(EventType.TOOL_RESULT, {
                        "tool": call_name,
                        "result": result_str,
                    })

                    # Collect function response for batched history entry
                    try:
                        result_data = json.loads(result_str)
                    except json.JSONDecodeError:
                        result_data = {"output": result_str}
                    function_responses.append((call_name, result_data))

                # ── Regular text ─────────────────────────────────────
                elif hasattr(part, "text") and part.text:
                    text_parts.append(part.text)

            # ── Emit thought summaries (Gemini 3 reasoning visible to user) ──
            if thought_parts:
                yield AgentEvent(EventType.THOUGHT, {
                    "text": "\n".join(thought_parts),
                })

            # If there were no tool calls, the model is done
            if not has_tool_calls:
                final_text = "\n".join(text_parts)
                yield AgentEvent(EventType.TEXT, {"text": final_text})
                yield AgentEvent(EventType.DONE, {})
                return

            # Add all function responses as a single user turn
            if function_responses:
                session.add_function_responses(function_responses)

            # If there was text alongside tool calls, emit it
            if text_parts:
                yield AgentEvent(EventType.THOUGHT, {"text": "\n".join(text_parts)})

        # Hit max iterations
        yield AgentEvent(EventType.TEXT, {"text": "Reached maximum iterations. Here's what I've done so far."})
        yield AgentEvent(EventType.DONE, {})

