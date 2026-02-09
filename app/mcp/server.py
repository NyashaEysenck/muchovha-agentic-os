"""
FastMCP server — exposes MuchovhaOS tools and skills over the Model Context Protocol.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from pathlib import Path

from fastmcp import FastMCP

from ..config import config

logger = logging.getLogger(__name__)

mcp = FastMCP("MuchovhaOS", description="MuchovhaOS — terminal, filesystem, skills over MCP")


# ── Tools ────────────────────────────────────────────────────────────────


@mcp.tool
async def execute_command(command: str, timeout: int = 30) -> str:
    """Execute a shell command in the MuchovhaOS terminal and return the output."""
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd="/home/agent",
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        output = stdout.decode(errors="replace")
        if stderr:
            err = stderr.decode(errors="replace")
            if err.strip():
                output += "\nSTDERR:\n" + err
        return output.strip()[:8000]
    except asyncio.TimeoutError:
        return f"Error: command timed out after {timeout}s"
    except Exception as e:
        return f"Error: {e}"


@mcp.tool
async def read_file(path: str) -> str:
    """Read the contents of a file at the given absolute path."""
    try:
        with open(path, "r", errors="replace") as f:
            return f.read(100_000)
    except FileNotFoundError:
        return f"Error: file not found: {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error reading {path}: {e}"


@mcp.tool
async def write_file(path: str, content: str) -> str:
    """Write content to a file, creating parent directories as needed."""
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        return f"Written {len(content)} bytes to {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error writing {path}: {e}"


@mcp.tool
async def list_directory(path: str = "/home/agent") -> str:
    """List files and directories at the given path."""
    try:
        entries = []
        for entry in sorted(os.listdir(path)):
            full = os.path.join(path, entry)
            if os.path.isdir(full):
                entries.append(f"[D] {entry}/")
            else:
                size = os.path.getsize(full)
                entries.append(f"    {entry}  ({size} bytes)")
        return "\n".join(entries) if entries else "(empty directory)"
    except FileNotFoundError:
        return f"Error: directory not found: {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error listing {path}: {e}"


@mcp.tool
async def system_status() -> str:
    """Get current system status: CPU, memory, disk, uptime."""
    try:
        import agent_kernel  # type: ignore
        cpu = agent_kernel.SystemMetrics.cpu()
        mem = agent_kernel.SystemMetrics.memory()
        disk = agent_kernel.SystemMetrics.disk("/")
        return (
            f"CPU: {cpu.usage_percent:.1f}% ({cpu.core_count} cores, "
            f"load: {cpu.load_1m:.2f} {cpu.load_5m:.2f} {cpu.load_15m:.2f})\n"
            f"Memory: {mem.used_kb // 1024}MB / {mem.total_kb // 1024}MB ({mem.usage_percent:.1f}%)\n"
            f"Disk: {disk.used_bytes // (1024**3)}GB / {disk.total_bytes // (1024**3)}GB ({disk.usage_percent:.1f}%)"
        )
    except ImportError:
        try:
            result = subprocess.run(["free", "-h"], capture_output=True, text=True, timeout=5)
            return result.stdout
        except Exception:
            return "Error: system metrics unavailable"


# ── Resources ────────────────────────────────────────────────────────────


@mcp.resource("os://hostname")
async def hostname() -> str:
    """The hostname of this MuchovhaOS instance."""
    import socket
    return socket.gethostname()


@mcp.resource("os://environment")
async def environment() -> str:
    """Key environment variables."""
    safe_keys = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "PWD"]
    return "\n".join(f"{k}={os.environ.get(k, '')}" for k in safe_keys)


# ── Skills as resources (using FastMCP SkillsDirectoryProvider) ──────────

try:
    from fastmcp.server.providers.skills import SkillsDirectoryProvider

    skill_roots = []
    for d in [config.skills.bundled_dir, config.skills.system_dir, config.skills.user_dir]:
        if os.path.isdir(d):
            skill_roots.append(Path(d))

    if skill_roots:
        mcp.add_provider(SkillsDirectoryProvider(roots=skill_roots, reload=True))
        logger.info("Mounted %d skill root(s) via FastMCP SkillsDirectoryProvider", len(skill_roots))
except ImportError:
    logger.warning("FastMCP SkillsDirectoryProvider not available (requires fastmcp>=3.0)")
except Exception:
    logger.warning("Failed to mount skills provider", exc_info=True)
