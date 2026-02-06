"""
Centralised application configuration.

All tunables live here so nothing is scattered across modules.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class AIConfig:
    """Settings for the Gemini AI backend."""

    api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    model: str = "gemini-3-flash-preview"

    # Conversation limits
    max_history_turns: int = 20
    summary_threshold: int = 16  # summarise older turns when history exceeds this

    # Generation safety
    max_output_tokens: int = 4096


@dataclass(frozen=True)
class MultimodalConfig:
    """Settings for multimodal input handling (images, audio, screenshots)."""

    max_image_size_mb: float = 10.0
    max_audio_size_mb: float = 25.0
    max_audio_duration_sec: int = 300  # 5 minutes

    supported_image_types: tuple[str, ...] = (
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
    )
    supported_audio_types: tuple[str, ...] = (
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/mp3",
        "audio/mpeg",
        "audio/mp4",
    )

    @property
    def max_image_bytes(self) -> int:
        return int(self.max_image_size_mb * 1024 * 1024)

    @property
    def max_audio_bytes(self) -> int:
        return int(self.max_audio_size_mb * 1024 * 1024)

    @property
    def all_supported_types(self) -> tuple[str, ...]:
        return self.supported_image_types + self.supported_audio_types


@dataclass(frozen=True)
class TerminalConfig:
    """Settings for the PTY terminal manager."""

    default_shell: str = "/bin/bash"
    default_cols: int = 80
    default_rows: int = 24
    history_chunk_limit: int = 200
    history_char_limit: int = 4_000
    home_dir: str = "/home/learner"
    read_buffer_size: int = 4096


@dataclass(frozen=True)
class ServerConfig:
    """Settings for the FastAPI server."""

    host: str = "0.0.0.0"
    port: int = 8000
    static_dir: str = field(
        default_factory=lambda: os.path.join(os.path.dirname(__file__), "static"),
    )
    pty_poll_interval: float = 0.02  # seconds between PTY reads (~50 fps)


@dataclass(frozen=True)
class AppConfig:
    """Top-level config aggregating all sub-configs."""

    ai: AIConfig = field(default_factory=AIConfig)
    multimodal: MultimodalConfig = field(default_factory=MultimodalConfig)
    terminal: TerminalConfig = field(default_factory=TerminalConfig)
    server: ServerConfig = field(default_factory=ServerConfig)


# Module-level singleton — import this wherever you need settings.
config = AppConfig()
