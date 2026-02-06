"""
PTY-based terminal manager.

Spawns real bash shells and manages I/O via file descriptors.
Each browser tab gets its own isolated PTY session.
"""

from __future__ import annotations

import fcntl
import logging
import os
import pty
import struct
import subprocess
import termios
from dataclasses import dataclass, field

from .config import config

logger = logging.getLogger(__name__)


@dataclass
class TerminalSession:
    """State for a single PTY session."""

    session_id: str
    master_fd: int
    process: subprocess.Popen
    history: list[str] = field(default_factory=list)

    @property
    def is_alive(self) -> bool:
        return self.process.poll() is None

    def close(self) -> None:
        """Gracefully terminate the session."""
        try:
            os.close(self.master_fd)
        except OSError:
            logger.debug("Session %s: master_fd already closed", self.session_id)
        try:
            self.process.terminate()
            self.process.wait(timeout=3)
        except Exception:
            self.process.kill()
            logger.warning("Session %s: had to force-kill process", self.session_id)
        logger.info("Session %s: closed", self.session_id)


class TerminalManager:
    """
    Manages multiple PTY sessions.

    Each session is a real bash shell connected to the browser
    via WebSocket in ``main.py``.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, TerminalSession] = {}

    def create_session(
        self,
        session_id: str,
        cols: int | None = None,
        rows: int | None = None,
    ) -> str:
        """Spawn a new PTY shell and register the session."""
        cols = cols or config.terminal.default_cols
        rows = rows or config.terminal.default_rows

        master_fd, slave_fd = pty.openpty()

        # Set initial terminal size
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["PS1"] = (
            r"\[\033[1;32m\]learner\[\033[0m\]@"
            r"\[\033[1;34m\]linux-mentor\[\033[0m\]:"
            r"\[\033[1;33m\]\w\[\033[0m\]\$ "
        )

        process = subprocess.Popen(
            [config.terminal.default_shell, "--login"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=os.setsid,
            env=env,
            cwd=config.terminal.home_dir,
        )

        os.close(slave_fd)

        # Non-blocking reads so the async loop never stalls
        flag = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flag | os.O_NONBLOCK)

        session = TerminalSession(
            session_id=session_id,
            master_fd=master_fd,
            process=process,
        )
        self._sessions[session_id] = session
        logger.info("Session %s: PTY created (pid=%d)", session_id, process.pid)
        return session_id

    def write(self, session_id: str, data: bytes) -> None:
        """Send raw bytes to the PTY (user keystrokes)."""
        session = self._get(session_id)
        if session:
            os.write(session.master_fd, data)

    def read(self, session_id: str) -> bytes:
        """
        Non-blocking read from the PTY.

        Returns empty bytes if nothing is available or session is gone.
        """
        session = self._get(session_id)
        if not session:
            return b""
        try:
            data = os.read(session.master_fd, config.terminal.read_buffer_size)
            # Append to scrollback history
            text = data.decode("utf-8", errors="replace")
            session.history.append(text)
            if len(session.history) > config.terminal.history_chunk_limit:
                session.history = session.history[-config.terminal.history_chunk_limit :]
            return data
        except (OSError, IOError):
            return b""

    def get_history(self, session_id: str) -> str:
        """Return the last N chars of terminal scrollback."""
        session = self._get(session_id)
        if not session:
            return ""
        full = "".join(session.history)
        return full[-config.terminal.history_char_limit :]

    def resize(self, session_id: str, cols: int, rows: int) -> None:
        """Update the PTY window size (e.g. when the browser resizes)."""
        session = self._get(session_id)
        if session:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(session.master_fd, termios.TIOCSWINSZ, winsize)

    def is_alive(self, session_id: str) -> bool:
        """Check whether the shell process is still running."""
        session = self._get(session_id)
        return session.is_alive if session else False

    def close_session(self, session_id: str) -> None:
        """Terminate and remove a session."""
        session = self._sessions.pop(session_id, None)
        if session:
            session.close()

    @property
    def active_count(self) -> int:
        return len(self._sessions)

    # ── Private ─────────────────────────────────────────────────────────

    def _get(self, session_id: str) -> TerminalSession | None:
        session = self._sessions.get(session_id)
        if not session:
            logger.debug("Session %s: not found", session_id)
        return session
