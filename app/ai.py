"""
Gemini 3 Flash AI assistant for Linux mentoring.

This module owns the Gemini client and all AI interactions.
Conversation state is delegated to ``history.SessionManager``;
prompt composition is delegated to ``prompts.PromptBuilder``.

Supports multimodal input: text, images, audio, and terminal screenshots
are all forwarded to the Gemini API as inline content parts.
"""

from __future__ import annotations

import logging

from google import genai

from .config import config
from .history import MediaAttachment, SessionManager
from .prompts import AssistantMode, PromptBuilder, prompt_builder

logger = logging.getLogger(__name__)


class AIAssistant:
    """
    High-level wrapper around the Gemini generative AI client.

    Responsibilities:
    - Manage the genai client lifecycle.
    - Delegate history to ``SessionManager``.
    - Delegate prompt assembly to ``PromptBuilder``.
    - Provide domain-specific convenience methods (chat, explain_error, suggest).
    - Handle multimodal inputs (images, audio) via Gemini's inline_data parts.
    """

    def __init__(self, builder: PromptBuilder | None = None) -> None:
        self._client = genai.Client(api_key=config.ai.api_key)
        self._model = config.ai.model
        self._sessions = SessionManager()
        self._builder = builder or prompt_builder

    # ── Core chat ───────────────────────────────────────────────────────

    async def chat(
        self,
        session_id: str,
        user_message: str,
        terminal_context: str = "",
        mode: str = "guided",
        attachments: list[MediaAttachment] | None = None,
    ) -> str:
        """
        Send a user message and return the model's reply.

        The conversation history, terminal context, and media attachments
        are managed automatically.
        """
        history = self._sessions.get_or_create(session_id)

        # Record user turn (with any media attachments)
        history.add_user_message(
            text=user_message,
            terminal_context=terminal_context,
            mode=mode,
            attachments=attachments,
        )

        # Build full prompt payload
        contents = self._builder.build(history, mode=mode)

        media_summary = ""
        if attachments:
            types = [a.label or a.mime_type for a in attachments]
            media_summary = f", media=[{', '.join(types)}]"

        logger.debug(
            "Session %s: sending %d content blocks (mode=%s%s)",
            session_id,
            len(contents),
            mode,
            media_summary,
        )

        reply_text = await self._generate(contents)

        # Record model turn
        history.add_model_message(reply_text)

        return reply_text

    # ── Multimodal one-shot helpers ─────────────────────────────────────

    async def analyze_image(
        self,
        image_data: str,
        mime_type: str,
        prompt: str = "",
        terminal_context: str = "",
    ) -> str:
        """One-shot image analysis — no session history needed."""
        text_prompt = prompt or "Describe what you see in this image."
        if terminal_context:
            text_prompt = (
                f"<terminal_history>\n{terminal_context}\n</terminal_history>\n\n"
                + text_prompt
            )

        system_text = self._builder.get_system_prompt(AssistantMode.GUIDED)
        contents = [
            {"role": "user", "parts": [{"text": system_text}]},
            {"role": "model", "parts": [{"text": "Ready to help."}]},
            {
                "role": "user",
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": image_data}},
                    {"text": text_prompt},
                ],
            },
        ]
        return await self._generate(contents)

    async def transcribe_and_respond(
        self,
        audio_data: str,
        mime_type: str,
        terminal_context: str = "",
    ) -> str:
        """One-shot audio → transcription + response (no session history)."""
        text_prompt = (
            "The user sent a voice message. Listen to it carefully, then:\n"
            "1. Briefly note what they asked (do NOT write a full transcription).\n"
            "2. Answer their question or follow their instruction.\n"
        )
        if terminal_context:
            text_prompt = (
                f"<terminal_history>\n{terminal_context}\n</terminal_history>\n\n"
                + text_prompt
            )

        system_text = self._builder.get_system_prompt(AssistantMode.GUIDED)
        contents = [
            {"role": "user", "parts": [{"text": system_text}]},
            {"role": "model", "parts": [{"text": "Ready to help."}]},
            {
                "role": "user",
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": audio_data}},
                    {"text": text_prompt},
                ],
            },
        ]
        return await self._generate(contents)

    # ── Stateless helpers ───────────────────────────────────────────────

    async def explain_error(self, terminal_context: str) -> str:
        """One-shot error analysis — no session history needed."""
        prompt = (
            "Analyze the terminal output below. Identify any errors, explain what "
            "went wrong in simple terms, and give the corrected command.\n\n"
            f"<terminal_output>\n{terminal_context}\n</terminal_output>"
        )
        return await self._one_shot(prompt)

    async def suggest_command(self, task_description: str) -> str:
        """One-shot command suggestion — no session history needed."""
        prompt = (
            f"The user wants to: {task_description}\n\n"
            "Give the exact Linux command(s) to accomplish this, with a brief explanation."
        )
        return await self._one_shot(prompt)

    # ── Session management ──────────────────────────────────────────────

    def clear_session(self, session_id: str) -> None:
        """Reset conversation history for a session."""
        history = self._sessions.get_or_create(session_id)
        history.clear()

    def remove_session(self, session_id: str) -> None:
        """Fully remove a session from memory."""
        self._sessions.remove(session_id)

    def get_session_stats(self, session_id: str) -> dict:
        """Return diagnostic info about a session."""
        history = self._sessions.get_or_create(session_id)
        return history.get_stats()

    def list_sessions(self) -> list[dict]:
        """List all active sessions."""
        return self._sessions.list_sessions()

    # ── Private helpers ─────────────────────────────────────────────────

    async def _generate(self, contents: list[dict]) -> str:
        """Call Gemini and return the text, with error handling."""
        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=contents,
            )
            text = response.text
            if not text:
                logger.warning("Gemini returned empty response")
                return "I couldn't generate a response. Please try again."
            return text
        except Exception:
            logger.exception("Gemini API call failed")
            raise

    async def _one_shot(self, prompt: str) -> str:
        """Send a single prompt with the base system context (no history)."""
        system_text = self._builder.get_system_prompt(AssistantMode.GUIDED)
        contents = [
            {"role": "user", "parts": [{"text": system_text}]},
            {"role": "model", "parts": [{"text": "Ready to help."}]},
            {"role": "user", "parts": [{"text": prompt}]},
        ]
        return await self._generate(contents)
