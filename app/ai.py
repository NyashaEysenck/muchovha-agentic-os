"""
Gemini 3 Flash AI assistant for Linux mentoring.
"""

import os
from google import genai

SYSTEM_PROMPT = """\
You are **LinuxMentor** — an AI tutor embedded inside a live Linux terminal.

WHAT YOU CAN SEE:
• The user's recent terminal history (commands they ran and the output).

HOW TO HELP:
1. **Explain** — break down commands and output in plain language.
2. **Fix** — when there's an error, say exactly what went wrong and give the corrected command.
3. **Teach** — answer "how do I …" questions with practical examples using the terminal context.
4. **Guide** — for multi-step tasks, give numbered steps the user can follow.

STYLE RULES:
- Be concise. No fluff.
- Put commands in `code blocks`.
- Explain *why* something works, not just *what* to type.
- Warn about destructive commands (rm -rf, chmod 777, etc.).
- Use analogies when explaining concepts to beginners.
- If the user seems experienced, be more terse.
- Format output as Markdown.
"""


class AIAssistant:
    def __init__(self, api_key: str | None = None):
        key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.client = genai.Client(api_key=key)
        self.model = "gemini-3-flash-preview"
        self.conversations: dict[str, list] = {}

    def _history(self, session_id: str) -> list:
        if session_id not in self.conversations:
            self.conversations[session_id] = []
        return self.conversations[session_id]

    async def chat(
        self, session_id: str, user_message: str, terminal_context: str = ""
    ) -> str:
        history = self._history(session_id)

        # Build contextual prompt
        parts: list[str] = []
        if terminal_context.strip():
            parts.append(
                f"<terminal_history>\n{terminal_context}\n</terminal_history>\n\n"
            )
        parts.append(user_message)
        full_prompt = "".join(parts)

        history.append({"role": "user", "parts": [{"text": full_prompt}]})

        # Trim to last 20 turns
        if len(history) > 20:
            history[:] = history[-20:]

        contents = [
            {"role": "user", "parts": [{"text": SYSTEM_PROMPT}]},
            {"role": "model", "parts": [{"text": "Understood. I'm LinuxMentor, ready to help you learn Linux. What would you like to know?"}]},
            *history,
        ]

        response = self.client.models.generate_content(
            model=self.model,
            contents=contents,
        )

        reply = response.text or "I couldn't generate a response. Please try again."
        history.append({"role": "model", "parts": [{"text": reply}]})
        return reply

    async def explain_error(self, terminal_context: str) -> str:
        prompt = (
            "Analyze the terminal output below. Identify any errors, explain what "
            "went wrong in simple terms, and give the corrected command.\n\n"
            f"<terminal_output>\n{terminal_context}\n</terminal_output>"
        )
        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                {"role": "user", "parts": [{"text": SYSTEM_PROMPT}]},
                {"role": "model", "parts": [{"text": "Ready to help."}]},
                {"role": "user", "parts": [{"text": prompt}]},
            ],
        )
        return response.text or "Could not analyze the error."

    async def suggest_command(self, task_description: str) -> str:
        prompt = (
            f"The user wants to: {task_description}\n\n"
            "Give the exact Linux command(s) to accomplish this, with a brief explanation."
        )
        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                {"role": "user", "parts": [{"text": SYSTEM_PROMPT}]},
                {"role": "model", "parts": [{"text": "Ready to help."}]},
                {"role": "user", "parts": [{"text": prompt}]},
            ],
        )
        return response.text or "Could not generate a suggestion."
