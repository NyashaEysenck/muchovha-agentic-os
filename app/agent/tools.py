"""
Tool registry for the agent loop.

Each tool is a callable with a JSON Schema describing its parameters.
The registry provides discovery (for Gemini function declarations)
and execution (dispatching tool calls by name).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ToolParam:
    name: str
    type: str  # "string", "integer", "boolean", "number"
    description: str
    required: bool = True
    enum: list[str] | None = None


@dataclass(frozen=True)
class ToolDef:
    """Definition of a tool the agent can call."""
    name: str
    description: str
    parameters: list[ToolParam]
    handler: Callable[..., Awaitable[str]]

    def to_gemini_declaration(self) -> dict[str, Any]:
        """Convert to Gemini function_declarations format."""
        properties = {}
        required = []
        for p in self.parameters:
            prop: dict[str, Any] = {"type": p.type, "description": p.description}
            if p.enum:
                prop["enum"] = p.enum
            properties[p.name] = prop
            if p.required:
                required.append(p.name)
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        }


class ToolRegistry:
    """Central registry of all tools available to the agent."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolDef] = {}

    def register(self, tool: ToolDef) -> None:
        self._tools[tool.name] = tool
        logger.info("Registered tool: %s", tool.name)

    def get(self, name: str) -> ToolDef | None:
        return self._tools.get(name)

    def list_names(self) -> list[str]:
        return list(self._tools.keys())

    def to_gemini_tools(self) -> list[dict]:
        """Return the tools payload for Gemini generate_content."""
        declarations = [t.to_gemini_declaration() for t in self._tools.values()]
        return [{"function_declarations": declarations}]

    async def execute(self, name: str, arguments: dict[str, Any]) -> str:
        """Execute a tool by name. Returns the result as a string."""
        tool = self._tools.get(name)
        if not tool:
            return json.dumps({"error": f"Unknown tool: {name}"})
        try:
            result = await tool.handler(**arguments)
            return result
        except Exception as e:
            logger.exception("Tool %s failed", name)
            return json.dumps({"error": str(e)})

    @property
    def count(self) -> int:
        return len(self._tools)


# ═══════════════════════════════════════════════════════════════════════════
# Built-in tool implementations
# ═══════════════════════════════════════════════════════════════════════════


async def _execute_command(command: str, timeout: int = 30) -> str:
    """Execute a shell command using the C++ sandbox (with resource limits)."""
    try:
        import agent_kernel  # type: ignore

        policy = agent_kernel.SandboxPolicy()
        policy.working_dir = "/home/agent"
        policy.drop_privileges = False  # already running as agent user
        policy.limits.max_memory_bytes = 512 * 1024 * 1024   # 512 MB
        policy.limits.max_file_size = 100 * 1024 * 1024      # 100 MB
        policy.limits.max_open_files = 256
        policy.limits.max_processes = 64

        loop = asyncio.get_running_loop()
        if timeout > 0:
            result = await loop.run_in_executor(
                None, lambda: agent_kernel.Sandbox.run_with_timeout(command, timeout, policy)
            )
        else:
            result = await loop.run_in_executor(
                None, lambda: agent_kernel.Sandbox.run(command, policy)
            )

        output = result.stdout_output
        if result.stderr_output:
            output += "\n" + result.stderr_output

        resp: dict[str, Any] = {
            "exit_code": result.exit_code,
            "output": output.strip()[:8000],
        }
        if result.timed_out:
            resp["timed_out"] = True
            resp["error"] = f"Command timed out after {timeout}s"
        return json.dumps(resp)

    except ImportError:
        # Fallback: pure-Python subprocess if C++ kernel not available
        logger.debug("agent_kernel not available, falling back to asyncio subprocess")
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
                output += "\n" + stderr.decode(errors="replace")
            return json.dumps({
                "exit_code": proc.returncode,
                "output": output.strip()[:8000],
            })
        except asyncio.TimeoutError:
            return json.dumps({"error": "Command timed out", "timeout": timeout})
        except Exception as e:
            return json.dumps({"error": str(e)})

    except Exception as e:
        return json.dumps({"error": str(e)})


async def _read_file(path: str) -> str:
    """Read a file and return its contents."""
    try:
        with open(path, "r", errors="replace") as f:
            content = f.read(100_000)
        return json.dumps({"path": path, "content": content})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def _write_file(path: str, content: str) -> str:
    """Write content to a file."""
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        return json.dumps({"path": path, "bytes_written": len(content)})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def _list_directory(path: str = ".") -> str:
    """List files and directories at the given path."""
    try:
        entries = []
        for entry in sorted(os.listdir(path)):
            full = os.path.join(path, entry)
            is_dir = os.path.isdir(full)
            size = os.path.getsize(full) if not is_dir else 0
            entries.append({"name": entry, "is_dir": is_dir, "size": size})
        return json.dumps({"path": path, "entries": entries})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def _search_files(pattern: str, path: str = "/home/agent") -> str:
    """Search for files matching a glob pattern using the C++ kernel."""
    try:
        import agent_kernel  # type: ignore

        loop = asyncio.get_running_loop()
        results = await loop.run_in_executor(
            None, lambda: agent_kernel.FileUtils.search(path, pattern, 10, 100)
        )
        matches = [
            {"path": r.path, "size": r.size, "is_dir": r.is_dir}
            for r in results
        ]
        return json.dumps({"pattern": pattern, "root": path, "matches": matches})

    except ImportError:
        # Fallback to find command
        try:
            proc = await asyncio.create_subprocess_exec(
                "find", path, "-maxdepth", "5", "-name", pattern, "-type", "f",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            files = [f for f in stdout.decode().strip().split("\n") if f]
            return json.dumps({"pattern": pattern, "matches": files[:50]})
        except Exception as e:
            return json.dumps({"error": str(e)})


async def _system_info() -> str:
    """Get system metrics (CPU, memory, disk) + container info."""
    try:
        import agent_kernel  # type: ignore
        cpu = agent_kernel.SystemMetrics.cpu()
        mem = agent_kernel.SystemMetrics.memory()
        disk = agent_kernel.SystemMetrics.disk("/")

        result: dict[str, Any] = {
            "cpu": {"usage_percent": round(cpu.usage_percent, 1), "cores": cpu.core_count,
                    "load": [cpu.load_1m, cpu.load_5m, cpu.load_15m]},
            "memory": {"total_mb": mem.total_kb // 1024, "used_mb": mem.used_kb // 1024,
                       "usage_percent": round(mem.usage_percent, 1)},
            "disk": {"total_gb": round(disk.total_bytes / 1e9, 1),
                     "used_gb": round(disk.used_bytes / 1e9, 1),
                     "usage_percent": round(disk.usage_percent, 1)},
        }

        # Add container info
        try:
            cg = agent_kernel.CgroupManager.info()
            result["container"] = {
                "is_containerized": cg.is_containerized,
                "cgroup_version": cg.cgroup_version,
                "memory_limit_mb": round(cg.memory_limit_bytes / 1e6, 1) if cg.memory_limit_bytes > 0 else None,
                "memory_usage_mb": round(cg.memory_usage_bytes / 1e6, 1) if cg.memory_usage_bytes > 0 else None,
                "cpu_quota": round(cg.cpu_quota, 2) if cg.cpu_quota > 0 else None,
                "pids_limit": cg.pids_limit if cg.pids_limit > 0 else None,
                "pids_current": cg.pids_current if cg.pids_current > 0 else None,
            }
        except Exception:
            pass

        return json.dumps(result)

    except ImportError:
        return json.dumps({"error": "agent_kernel not available, using fallback"})


async def _process_list() -> str:
    """List running processes sorted by memory usage."""
    try:
        import agent_kernel  # type: ignore
        procs = agent_kernel.ProcessManager.list_all()
        # Return top 30 by memory usage
        sorted_procs = sorted(procs, key=lambda p: p.rss_kb, reverse=True)[:30]
        return json.dumps({
            "processes": [
                {"pid": p.pid, "name": p.name, "state": p.state,
                 "rss_mb": round(p.rss_kb / 1024, 1), "cmdline": p.cmdline[:120]}
                for p in sorted_procs
            ]
        })
    except ImportError:
        return json.dumps({"error": "agent_kernel not available"})


async def _process_tree() -> str:
    """Show the process tree with parent-child hierarchy."""
    try:
        import agent_kernel  # type: ignore
        nodes = agent_kernel.ProcessManager.tree()
        tree = []
        for node in nodes[:80]:  # cap output
            p = node.info
            indent = "  " * node.depth
            tree.append({
                "pid": p.pid,
                "ppid": p.ppid,
                "depth": node.depth,
                "name": p.name,
                "state": p.state,
                "rss_mb": round(p.rss_kb / 1024, 1),
                "display": f"{indent}{p.name} (pid={p.pid}, rss={round(p.rss_kb / 1024, 1)}MB)",
            })
        return json.dumps({"tree": tree})
    except ImportError:
        return json.dumps({"error": "agent_kernel not available"})


async def _network_connections(protocol: str = "tcp") -> str:
    """List network connections (tcp, tcp6, udp, udp6)."""
    try:
        import agent_kernel  # type: ignore
        conns = agent_kernel.NetworkMonitor.connections(protocol)
        return json.dumps({
            "protocol": protocol,
            "count": len(conns),
            "connections": [
                {
                    "local": f"{c.local_addr}:{c.local_port}",
                    "remote": f"{c.remote_addr}:{c.remote_port}",
                    "state": c.state,
                }
                for c in conns[:100]
            ],
        })
    except ImportError:
        return json.dumps({"error": "agent_kernel not available"})


async def _network_interfaces() -> str:
    """Get network interface statistics."""
    try:
        import agent_kernel  # type: ignore
        ifaces = agent_kernel.NetworkMonitor.interfaces()
        return json.dumps({
            "interfaces": [
                {
                    "name": i.name,
                    "rx_mb": round(i.rx_bytes / 1e6, 2),
                    "tx_mb": round(i.tx_bytes / 1e6, 2),
                    "rx_packets": i.rx_packets,
                    "tx_packets": i.tx_packets,
                    "rx_errors": i.rx_errors,
                    "tx_errors": i.tx_errors,
                }
                for i in ifaces
            ],
        })
    except ImportError:
        return json.dumps({"error": "agent_kernel not available"})


async def _listening_ports() -> str:
    """List all listening ports on the system."""
    try:
        import agent_kernel  # type: ignore
        ports = agent_kernel.NetworkMonitor.listening_ports()
        return json.dumps({
            "count": len(ports),
            "ports": [
                {
                    "protocol": p.protocol,
                    "address": p.local_addr,
                    "port": p.local_port,
                }
                for p in ports
            ],
        })
    except ImportError:
        return json.dumps({"error": "agent_kernel not available"})


async def _tail_file(path: str, lines: int = 50) -> str:
    """Read the last N lines of a file (efficient for large log files)."""
    try:
        import agent_kernel  # type: ignore
        loop = asyncio.get_running_loop()
        content = await loop.run_in_executor(
            None, lambda: agent_kernel.FileUtils.tail(path, lines)
        )
        return json.dumps({"path": path, "lines": lines, "content": content})
    except ImportError:
        # Fallback
        try:
            proc = await asyncio.create_subprocess_exec(
                "tail", "-n", str(lines), path,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
            return json.dumps({"path": path, "lines": lines, "content": stdout.decode(errors="replace")})
        except Exception as e:
            return json.dumps({"error": str(e)})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def _container_info() -> str:
    """Get container/cgroup information for the current environment."""
    try:
        import agent_kernel  # type: ignore
        cg = agent_kernel.CgroupManager.info()
        return json.dumps({
            "is_containerized": cg.is_containerized,
            "cgroup_version": cg.cgroup_version,
            "memory_limit_mb": round(cg.memory_limit_bytes / 1e6, 1) if cg.memory_limit_bytes > 0 else "unlimited",
            "memory_usage_mb": round(cg.memory_usage_bytes / 1e6, 1) if cg.memory_usage_bytes > 0 else "unknown",
            "cpu_quota_cores": round(cg.cpu_quota, 2) if cg.cpu_quota > 0 else "unlimited",
            "pids_limit": cg.pids_limit if cg.pids_limit > 0 else "unlimited",
            "pids_current": cg.pids_current if cg.pids_current > 0 else "unknown",
        })
    except ImportError:
        return json.dumps({"error": "agent_kernel not available"})


def create_builtin_tools() -> list[ToolDef]:
    """Create all built-in tools."""
    return [
        ToolDef(
            name="execute_command",
            description="Execute a shell command in a sandboxed environment with resource limits. Returns stdout, stderr, and exit code.",
            parameters=[
                ToolParam("command", "string", "The shell command to execute"),
                ToolParam("timeout", "integer", "Timeout in seconds (default 30)", required=False),
            ],
            handler=_execute_command,
        ),
        ToolDef(
            name="read_file",
            description="Read the contents of a file at the given path.",
            parameters=[
                ToolParam("path", "string", "Absolute path to the file"),
            ],
            handler=_read_file,
        ),
        ToolDef(
            name="write_file",
            description="Write content to a file, creating directories as needed.",
            parameters=[
                ToolParam("path", "string", "Absolute path to the file"),
                ToolParam("content", "string", "Content to write"),
            ],
            handler=_write_file,
        ),
        ToolDef(
            name="list_directory",
            description="List files and directories at a given path.",
            parameters=[
                ToolParam("path", "string", "Directory path to list", required=False),
            ],
            handler=_list_directory,
        ),
        ToolDef(
            name="search_files",
            description="Search for files matching a glob pattern using the native C++ file walker. Fast recursive search.",
            parameters=[
                ToolParam("pattern", "string", "Glob pattern like '*.py' or 'Makefile'"),
                ToolParam("path", "string", "Root directory to search from", required=False),
            ],
            handler=_search_files,
        ),
        ToolDef(
            name="system_info",
            description="Get current system metrics: CPU usage, memory, disk space, load averages, and container info.",
            parameters=[],
            handler=_system_info,
        ),
        ToolDef(
            name="process_list",
            description="List running processes sorted by memory usage.",
            parameters=[],
            handler=_process_list,
        ),
        ToolDef(
            name="process_tree",
            description="Show the process tree with parent-child hierarchy and depth indentation.",
            parameters=[],
            handler=_process_tree,
        ),
        ToolDef(
            name="network_connections",
            description="List network connections. Supports tcp, tcp6, udp, udp6 protocols.",
            parameters=[
                ToolParam("protocol", "string", "Protocol: tcp, tcp6, udp, or udp6 (default: tcp)", required=False),
            ],
            handler=_network_connections,
        ),
        ToolDef(
            name="network_interfaces",
            description="Get network interface statistics: bytes, packets, errors for each interface.",
            parameters=[],
            handler=_network_interfaces,
        ),
        ToolDef(
            name="listening_ports",
            description="List all listening ports on the system across all protocols.",
            parameters=[],
            handler=_listening_ports,
        ),
        ToolDef(
            name="tail_file",
            description="Read the last N lines of a file efficiently. Ideal for large log files.",
            parameters=[
                ToolParam("path", "string", "Absolute path to the file"),
                ToolParam("lines", "integer", "Number of lines to read from end (default 50)", required=False),
            ],
            handler=_tail_file,
        ),
        ToolDef(
            name="container_info",
            description="Get container/cgroup information: memory limits, CPU quota, PID limits, cgroup version.",
            parameters=[],
            handler=_container_info,
        ),
    ]
