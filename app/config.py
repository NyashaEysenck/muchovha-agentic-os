"""Centralised configuration. All tunables in one place."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class AIConfig:
    api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    model: str = "gemini-3-flash-preview"
    max_output_tokens: int = 8192
    max_history_turns: int = 40
    max_agent_iterations: int = 15


@dataclass(frozen=True)
class TerminalConfig:
    default_shell: str = "/bin/bash"
    default_cols: int = 80
    default_rows: int = 24
    history_chunk_limit: int = 200
    history_char_limit: int = 6_000
    home_dir: str = "/home/agent"
    read_buffer_size: int = 4096


@dataclass(frozen=True)
class SkillsConfig:
    system_dir: str = "/etc/muchovhaos/skills"
    user_dir: str = field(default_factory=lambda: os.path.expanduser("~/skills"))
    bundled_dir: str = field(
        default_factory=lambda: os.path.join(os.path.dirname(os.path.dirname(__file__)), "skills"),
    )


@dataclass(frozen=True)
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8000
    static_dir: str = field(
        default_factory=lambda: os.path.join(os.path.dirname(__file__), "static"),
    )
    pty_poll_interval: float = 0.02
    max_upload_bytes: int = 10 * 1024 * 1024  # 10 MB


@dataclass(frozen=True)
class AppConfig:
    ai: AIConfig = field(default_factory=AIConfig)
    terminal: TerminalConfig = field(default_factory=TerminalConfig)
    skills: SkillsConfig = field(default_factory=SkillsConfig)
    server: ServerConfig = field(default_factory=ServerConfig)


config = AppConfig()
