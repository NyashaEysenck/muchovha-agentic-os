"""PTY terminal manager. Spawns bash shells, manages I/O via file descriptors."""

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
    session_id: str
    master_fd: int
    process: subprocess.Popen
    history: list[str] = field(default_factory=list)

    @property
    def is_alive(self) -> bool:
        return self.process.poll() is None

    def close(self) -> None:
        try:
            os.close(self.master_fd)
        except OSError:
            pass
        try:
            self.process.terminate()
            self.process.wait(timeout=3)
        except Exception:
            self.process.kill()
        logger.info("Session %s closed", self.session_id)


class TerminalManager:
    """Manages multiple isolated PTY sessions."""

    def __init__(self) -> None:
        self._sessions: dict[str, TerminalSession] = {}

    def create_session(self, session_id: str, cols: int | None = None, rows: int | None = None) -> str:
        cols = cols or config.terminal.default_cols
        rows = rows or config.terminal.default_rows

        master_fd, slave_fd = pty.openpty()
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["PS1"] = r"\[\033[1;32m\]agent\[\033[0m\]@\[\033[1;34m\]os\[\033[0m\]:\[\033[1;33m\]\w\[\033[0m\]\$ "

        process = subprocess.Popen(
            [config.terminal.default_shell, "--login"],
            stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
            preexec_fn=os.setsid,
            env=env,
            cwd=config.terminal.home_dir,
        )
        os.close(slave_fd)

        flag = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flag | os.O_NONBLOCK)

        self._sessions[session_id] = TerminalSession(
            session_id=session_id, master_fd=master_fd, process=process,
        )
        logger.info("Session %s: PTY pid=%d", session_id, process.pid)
        return session_id

    def write(self, session_id: str, data: bytes) -> None:
        s = self._sessions.get(session_id)
        if s:
            try:
                os.write(s.master_fd, data)
            except OSError:
                pass

    def read(self, session_id: str) -> bytes:
        s = self._sessions.get(session_id)
        if not s:
            return b""
        try:
            data = os.read(s.master_fd, config.terminal.read_buffer_size)
            text = data.decode("utf-8", errors="replace")
            s.history.append(text)
            if len(s.history) > config.terminal.history_chunk_limit:
                s.history = s.history[-config.terminal.history_chunk_limit:]
            return data
        except (OSError, IOError):
            return b""

    def get_history(self, session_id: str) -> str:
        s = self._sessions.get(session_id)
        if not s:
            return ""
        full = "".join(s.history)
        return full[-config.terminal.history_char_limit:]

    def execute_command(self, session_id: str, command: str) -> None:
        """Write a command string followed by newline to the PTY."""
        s = self._sessions.get(session_id)
        if s:
            try:
                os.write(s.master_fd, (command + "\n").encode())
            except OSError:
                pass

    def resize(self, session_id: str, cols: int, rows: int) -> None:
        s = self._sessions.get(session_id)
        if s:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(s.master_fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def is_alive(self, session_id: str) -> bool:
        s = self._sessions.get(session_id)
        return s.is_alive if s else False

    def close_session(self, session_id: str) -> None:
        s = self._sessions.pop(session_id, None)
        if s:
            s.close()

    @property
    def active_count(self) -> int:
        return len(self._sessions)
