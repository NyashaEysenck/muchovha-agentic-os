"""
Structured conversation history management.

Provides typed message storage, automatic turn trimming,
context summarization, and clean serialization for the Gemini API.
Supports multimodal messages (images, audio) alongside text.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .config import config

logger = logging.getLogger(__name__)


# ── Data types ──────────────────────────────────────────────────────────────


class Role(str, Enum):
    """Valid conversation roles for the Gemini API."""

    USER = "user"
    MODEL = "model"


@dataclass
class MediaAttachment:
    """A binary media attachment (image or audio) sent alongside text."""

    mime_type: str
    data: str  # base64-encoded binary data
    label: str = ""  # human-readable label (e.g. "screenshot", "voice note")

    @property
    def is_image(self) -> bool:
        return self.mime_type.startswith("image/")

    @property
    def is_audio(self) -> bool:
        return self.mime_type.startswith("audio/")


@dataclass
class Message:
    """A single message in a conversation turn, optionally with media attachments."""

    role: Role
    text: str
    timestamp: float = field(default_factory=time.time)
    # Optional metadata (mode that was active, whether it had terminal context, etc.)
    metadata: dict[str, Any] = field(default_factory=dict)
    # Multimodal attachments (images, audio clips)
    attachments: list[MediaAttachment] = field(default_factory=list)

    def to_api_format(self) -> dict:
        """Serialize to the format Gemini's generate_content expects.

        For multimodal messages, returns parts with both text and inline_data.
        """
        parts: list[dict] = []

        # Add media parts first so the model "sees" them before reading text
        for att in self.attachments:
            parts.append({
                "inline_data": {
                    "mime_type": att.mime_type,
                    "data": att.data,
                }
            })

        # Always include the text part
        if self.text:
            parts.append({"text": self.text})

        return {"role": self.role.value, "parts": parts}

    @property
    def has_media(self) -> bool:
        return len(self.attachments) > 0


@dataclass
class ConversationSummary:
    """A compressed summary of older turns, injected as context."""

    text: str
    turn_count: int  # how many turns were compressed
    created_at: float = field(default_factory=time.time)


# ── Session history ─────────────────────────────────────────────────────────


class ConversationHistory:
    """
    Manages the message history for a single session.

    Responsibilities:
    - Append user/model messages with metadata.
    - Enforce a max turn window (configurable via AppConfig).
    - Summarize older context so it isn't lost entirely.
    - Serialize to the list-of-dicts format the Gemini API needs.
    """

    def __init__(
        self,
        session_id: str,
        max_turns: int | None = None,
        summary_threshold: int | None = None,
    ):
        self.session_id = session_id
        self.max_turns = max_turns or config.ai.max_history_turns
        self.summary_threshold = summary_threshold or config.ai.summary_threshold
        self._messages: list[Message] = []
        self._summary: ConversationSummary | None = None
        self._created_at = time.time()

    # ── Public API ──────────────────────────────────────────────────────

    def add_user_message(
        self,
        text: str,
        terminal_context: str = "",
        mode: str = "guided",
        attachments: list[MediaAttachment] | None = None,
    ) -> Message:
        """Add a user turn, optionally prepending terminal context and media."""
        parts: list[str] = []
        if terminal_context.strip():
            parts.append(f"<terminal_history>\n{terminal_context}\n</terminal_history>\n\n")
        parts.append(text)

        # Build metadata
        meta: dict[str, Any] = {
            "mode": mode,
            "has_terminal_ctx": bool(terminal_context.strip()),
        }
        if attachments:
            meta["attachment_count"] = len(attachments)
            meta["attachment_types"] = [a.mime_type for a in attachments]

        msg = Message(
            role=Role.USER,
            text="".join(parts),
            metadata=meta,
            attachments=attachments or [],
        )
        self._messages.append(msg)
        self._maybe_trim()
        return msg

    def add_model_message(self, text: str) -> Message:
        """Record the model's reply."""
        msg = Message(role=Role.MODEL, text=text)
        self._messages.append(msg)
        self._maybe_trim()
        return msg

    def to_api_contents(self) -> list[dict]:
        """
        Build the full `contents` list for the Gemini API.

        If a summary exists it is injected as a leading user/model exchange
        so the model has compressed context of earlier turns.
        """
        contents: list[dict] = []

        if self._summary:
            contents.append({
                "role": "user",
                "parts": [{"text": (
                    f"<conversation_summary>\n{self._summary.text}\n</conversation_summary>\n\n"
                    "The above is a summary of our earlier conversation. Continue from here."
                )}],
            })
            contents.append({
                "role": "model",
                "parts": [{"text": "Understood — I have the context from our earlier discussion. Let's continue."}],
            })

        for msg in self._messages:
            contents.append(msg.to_api_format())

        return contents

    @property
    def turn_count(self) -> int:
        """Number of messages currently in the active window."""
        return len(self._messages)

    @property
    def has_summary(self) -> bool:
        return self._summary is not None

    def clear(self) -> None:
        """Wipe all history and summaries for this session."""
        self._messages.clear()
        self._summary = None
        logger.info("Session %s: history cleared", self.session_id)

    def get_stats(self) -> dict:
        """Return diagnostic info about this session's history."""
        return {
            "session_id": self.session_id,
            "turn_count": self.turn_count,
            "has_summary": self.has_summary,
            "summary_turns_compressed": self._summary.turn_count if self._summary else 0,
            "created_at": self._created_at,
        }

    # ── Internal helpers ────────────────────────────────────────────────

    def _maybe_trim(self) -> None:
        """If history exceeds max_turns, summarize the oldest chunk and discard it."""
        if len(self._messages) <= self.max_turns:
            return

        # Number of messages to roll into summary
        overflow = len(self._messages) - self.summary_threshold
        if overflow <= 0:
            return

        old_messages = self._messages[:overflow]
        self._messages = self._messages[overflow:]

        # Build a textual summary of the trimmed messages
        summary_lines = self._compress(old_messages)
        prev_count = self._summary.turn_count if self._summary else 0
        prev_text = self._summary.text + "\n\n" if self._summary else ""

        self._summary = ConversationSummary(
            text=prev_text + summary_lines,
            turn_count=prev_count + len(old_messages),
        )
        logger.info(
            "Session %s: trimmed %d old turns → summary (%d total compressed)",
            self.session_id,
            len(old_messages),
            self._summary.turn_count,
        )

    @staticmethod
    def _compress(messages: list[Message]) -> str:
        """
        Produce a human-readable digest of a list of messages.

        This is a deterministic local summary (no LLM call).
        It preserves the essential Q/A structure so the model knows
        what was discussed without needing the raw text.
        """
        lines: list[str] = []
        for msg in messages:
            prefix = "User" if msg.role == Role.USER else "Assistant"
            # Truncate long messages to keep the summary compact
            text = msg.text
            if len(text) > 200:
                text = text[:200] + "…"
            # Strip terminal_history XML tags for brevity
            if "<terminal_history>" in text:
                text = "[terminal context provided] " + text.split("</terminal_history>")[-1].strip()
            # Note media attachments
            if msg.has_media:
                labels = [a.label or a.mime_type for a in msg.attachments]
                text = f"[attached: {', '.join(labels)}] " + text
            lines.append(f"- {prefix}: {text}")
        return "\n".join(lines)


# ── Session registry ────────────────────────────────────────────────────────


class SessionManager:
    """
    Registry of all active conversation sessions.

    Thread-safe for the single-process FastAPI model (async, no threads).
    """

    def __init__(self) -> None:
        self._sessions: dict[str, ConversationHistory] = {}

    def get_or_create(self, session_id: str) -> ConversationHistory:
        """Return existing session history or create a new one."""
        if session_id not in self._sessions:
            self._sessions[session_id] = ConversationHistory(session_id)
            logger.info("Session %s: created new conversation history", session_id)
        return self._sessions[session_id]

    def remove(self, session_id: str) -> None:
        """Discard a session's history (e.g. on disconnect)."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info("Session %s: removed from session manager", session_id)

    def list_sessions(self) -> list[dict]:
        """Return stats for all active sessions."""
        return [h.get_stats() for h in self._sessions.values()]

    @property
    def active_count(self) -> int:
        return len(self._sessions)
