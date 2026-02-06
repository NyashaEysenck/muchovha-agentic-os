"""
PTY-based terminal manager.
Spawns real bash shells and manages I/O via file descriptors.
"""

import fcntl
import os
import pty
import struct
import subprocess
import termios


class TerminalManager:
    def __init__(self):
        self.sessions: dict = {}

    def create_session(self, session_id: str, cols: int = 80, rows: int = 24) -> str:
        master_fd, slave_fd = pty.openpty()

        # Set terminal size
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["PS1"] = r"\[\033[1;32m\]learner\[\033[0m\]@\[\033[1;34m\]linux-mentor\[\033[0m\]:\[\033[1;33m\]\w\[\033[0m\]\$ "

        process = subprocess.Popen(
            ["/bin/bash", "--login"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=os.setsid,
            env=env,
            cwd="/home/learner",
        )

        os.close(slave_fd)

        # Make master_fd non-blocking
        flag = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flag | os.O_NONBLOCK)

        self.sessions[session_id] = {
            "master_fd": master_fd,
            "process": process,
            "history": [],
        }
        return session_id

    def write(self, session_id: str, data: bytes):
        session = self.sessions.get(session_id)
        if session:
            os.write(session["master_fd"], data)

    def read(self, session_id: str) -> bytes:
        session = self.sessions.get(session_id)
        if not session:
            return b""
        try:
            data = os.read(session["master_fd"], 4096)
            # Append to history buffer
            text = data.decode("utf-8", errors="replace")
            session["history"].append(text)
            # Keep last 200 chunks
            if len(session["history"]) > 200:
                session["history"] = session["history"][-200:]
            return data
        except (OSError, IOError):
            return b""

    def get_history(self, session_id: str) -> str:
        session = self.sessions.get(session_id)
        if not session:
            return ""
        # Return last ~4000 chars of history
        full = "".join(session["history"])
        return full[-4000:]

    def resize(self, session_id: str, cols: int, rows: int):
        session = self.sessions.get(session_id)
        if session:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(session["master_fd"], termios.TIOCSWINSZ, winsize)

    def is_alive(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False
        return session["process"].poll() is None

    def close_session(self, session_id: str):
        session = self.sessions.pop(session_id, None)
        if session:
            try:
                os.close(session["master_fd"])
            except OSError:
                pass
            try:
                session["process"].terminate()
                session["process"].wait(timeout=3)
            except Exception:
                session["process"].kill()
