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

MODE_ADDENDUMS = {
    "guided": "",  # Default tutor behavior — no changes
    "autopilot": """\

AUTOPILOT MODE — CRITICAL RULES:
The user has enabled autopilot. Any commands you suggest WILL BE EXECUTED AUTOMATICALLY.

- Always put runnable commands inside ```bash code blocks.
- Each command on its own line. No prose inside code blocks.
- NEVER include destructive commands (rm -rf /, chmod -R 777 /, mkfs, dd if=/dev/zero, etc.) without explicit user confirmation.
- Prefer safe, non-destructive, reversible commands.
- If a task is risky, explain the risk FIRST in prose, then ask the user to confirm before providing the code block.
- One logical step per response. Don't dump 10 commands at once.
- After giving a command, briefly explain what it did and what to expect.
""",
    "terminal": """\

SHELLMATE MODE — CRITICAL RULES:
Your response will be printed directly inside the user's terminal with ANSI formatting.
You must structure your reply so the frontend can parse it into segments.

FORMAT RULES:
- For explanatory text, just write normal sentences. Keep them short (1-3 sentences per point).
- For commands the user should run, put each on its own line starting with exactly: CMD: 
  Example: CMD: ls -la /home
- For important warnings, start the line with exactly: WARN: 
  Example: WARN: This will delete files permanently
- Do NOT use markdown (no **, ##, ```, bullets, etc.)
- Be terse and practical like a senior engineer pair-programming.
- Max 10 lines total. Shorter is better.
- If a task needs multiple commands, list them in order with CMD: prefix.

Example response:
List txt files in your home directory recursively.
CMD: find ~ -name "*.txt" -type f
Add -maxdepth 2 if you want to limit how deep it searches.
""",
}


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
        self, session_id: str, user_message: str, terminal_context: str = "",
        mode: str = "guided",
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

        # Build mode-aware system prompt
        system = SYSTEM_PROMPT + MODE_ADDENDUMS.get(mode, "")

        contents = [
            {"role": "user", "parts": [{"text": system}]},
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
