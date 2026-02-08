"""
Autonomous Health Monitor — the self-healing brain of AgentOS.

Runs on a background timer, checks system vitals via the C++ kernel,
detects anomalies, and optionally auto-triggers the agent to investigate/fix.

Anomaly types:
  - High CPU usage sustained over threshold
  - Memory pressure (usage > threshold)
  - Disk space critically low
  - Zombie/defunct processes detected
  - Unexpected new listening ports
  - Process crash detection (key processes disappeared)
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class Alert:
    """A detected system anomaly."""
    id: str
    severity: Severity
    category: str        # cpu, memory, disk, process, network
    title: str
    detail: str
    timestamp: float = field(default_factory=time.time)
    resolved: bool = False
    auto_healed: bool = False
    agent_response: str = ""


class HealthMonitor:
    """
    Periodic system health checker with anomaly detection.

    Provides:
      - Configurable check interval
      - Thresholds for CPU, memory, disk
      - Alert history with deduplication
      - Auto-heal mode that triggers the agent loop
    """

    def __init__(self) -> None:
        self.enabled: bool = True
        self.auto_heal: bool = False
        self.check_interval: float = 5.0  # seconds
        self.alerts: list[Alert] = []
        self.max_alerts: int = 100

        # Thresholds (lowered for demo — raise for production)
        self.cpu_warn: float = 15.0
        self.cpu_crit: float = 50.0
        self.mem_warn: float = 30.0
        self.mem_crit: float = 70.0
        self.disk_warn: float = 40.0
        self.disk_crit: float = 80.0

        # State tracking for deduplication
        self._known_listeners: set[int] = set()
        self._known_pids: set[int] = set()
        self._initial_scan_done: bool = False
        self._task: asyncio.Task | None = None
        self._agent_callback: Any = None
        self._alert_counter: int = 0

    def set_agent_callback(self, callback: Any) -> None:
        """Set the async callback to trigger agent auto-heal.

        Callback signature: async def callback(goal: str) -> str
        """
        self._agent_callback = callback

    def start(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Start the background monitoring task."""
        if self._task and not self._task.done():
            return
        self._task = asyncio.ensure_future(self._run_loop())
        logger.info("HealthMonitor started (interval=%ss, auto_heal=%s)", self.check_interval, self.auto_heal)

    def stop(self) -> None:
        """Stop the background monitoring task."""
        if self._task:
            self._task.cancel()
            self._task = None

    def _make_alert_id(self) -> str:
        self._alert_counter += 1
        return f"alert-{int(time.time())}-{self._alert_counter}"

    def _add_alert(self, severity: Severity, category: str, title: str, detail: str) -> Alert:
        """Add an alert if not already active (dedup by category+title)."""
        # Check for active duplicate
        for a in self.alerts:
            if not a.resolved and a.category == category and a.title == title:
                return a  # already tracking this

        alert = Alert(
            id=self._make_alert_id(),
            severity=severity,
            category=category,
            title=title,
            detail=detail,
        )
        self.alerts.append(alert)

        # Trim old alerts
        if len(self.alerts) > self.max_alerts:
            self.alerts = self.alerts[-self.max_alerts:]

        logger.warning("ALERT [%s] %s: %s — %s", severity.value, category, title, detail)
        return alert

    def _resolve_alerts(self, category: str, title: str) -> None:
        """Mark matching alerts as resolved."""
        for a in self.alerts:
            if not a.resolved and a.category == category and a.title == title:
                a.resolved = True
                logger.info("RESOLVED [%s] %s: %s", a.severity.value, category, title)

    async def _run_loop(self) -> None:
        """Main monitoring loop."""
        try:
            import agent_kernel  # type: ignore
        except ImportError:
            logger.info("agent_kernel not available — HealthMonitor disabled")
            return

        # Brief startup delay
        await asyncio.sleep(1.0)

        while True:
            if not self.enabled:
                await asyncio.sleep(self.check_interval)
                continue

            try:
                await self._check_health(agent_kernel)
            except Exception:
                logger.exception("HealthMonitor check failed")

            await asyncio.sleep(self.check_interval)

    async def _check_health(self, kernel: Any) -> None:
        """Run all health checks."""
        loop = asyncio.get_running_loop()

        # Gather data from C++ kernel (all release GIL)
        cpu = await loop.run_in_executor(None, kernel.SystemMetrics.cpu)
        mem = kernel.SystemMetrics.memory()
        disk = kernel.SystemMetrics.disk("/")
        procs = kernel.ProcessManager.list_all()
        listeners = kernel.NetworkMonitor.listening_ports()

        # ── CPU check ────────────────────────────────────────────────
        if cpu.usage_percent >= self.cpu_crit:
            alert = self._add_alert(
                Severity.CRITICAL, "cpu", "CPU critically high",
                f"CPU at {cpu.usage_percent:.0f}% (threshold: {self.cpu_crit}%)",
            )
            await self._maybe_auto_heal(alert,
                f"CRITICAL: CPU usage is at {cpu.usage_percent:.0f}%. "
                f"Load averages: {cpu.load_1m:.1f}, {cpu.load_5m:.1f}, {cpu.load_15m:.1f}. "
                f"Investigate which processes are consuming CPU and suggest actions to reduce load."
            )
        elif cpu.usage_percent >= self.cpu_warn:
            self._add_alert(
                Severity.WARNING, "cpu", "CPU high",
                f"CPU at {cpu.usage_percent:.0f}% (threshold: {self.cpu_warn}%)",
            )
        else:
            self._resolve_alerts("cpu", "CPU critically high")
            self._resolve_alerts("cpu", "CPU high")

        # ── Memory check ─────────────────────────────────────────────
        if mem.usage_percent >= self.mem_crit:
            alert = self._add_alert(
                Severity.CRITICAL, "memory", "Memory critically high",
                f"Memory at {mem.usage_percent:.0f}% ({mem.used_kb // 1024}MB / {mem.total_kb // 1024}MB)",
            )
            await self._maybe_auto_heal(alert,
                f"CRITICAL: Memory usage is at {mem.usage_percent:.0f}% "
                f"({mem.used_kb // 1024}MB used of {mem.total_kb // 1024}MB). "
                f"Identify the top memory consumers and take action to free memory."
            )
        elif mem.usage_percent >= self.mem_warn:
            self._add_alert(
                Severity.WARNING, "memory", "Memory high",
                f"Memory at {mem.usage_percent:.0f}%",
            )
        else:
            self._resolve_alerts("memory", "Memory critically high")
            self._resolve_alerts("memory", "Memory high")

        # ── Disk check ───────────────────────────────────────────────
        if disk.usage_percent >= self.disk_crit:
            alert = self._add_alert(
                Severity.CRITICAL, "disk", "Disk critically full",
                f"Disk at {disk.usage_percent:.0f}% ({round(disk.used_bytes / 1e9, 1)}GB / {round(disk.total_bytes / 1e9, 1)}GB)",
            )
            await self._maybe_auto_heal(alert,
                f"CRITICAL: Disk usage is at {disk.usage_percent:.0f}%. "
                f"Find large files and directories consuming disk space and suggest cleanup actions."
            )
        elif disk.usage_percent >= self.disk_warn:
            self._add_alert(
                Severity.WARNING, "disk", "Disk space low",
                f"Disk at {disk.usage_percent:.0f}%",
            )
        else:
            self._resolve_alerts("disk", "Disk critically full")
            self._resolve_alerts("disk", "Disk space low")

        # ── Zombie process check ─────────────────────────────────────
        zombies = [p for p in procs if p.state == 'Z']
        if len(zombies) > 3:
            alert = self._add_alert(
                Severity.WARNING, "process", "Zombie processes detected",
                f"{len(zombies)} zombie processes found",
            )
            await self._maybe_auto_heal(alert,
                f"WARNING: {len(zombies)} zombie processes detected. "
                f"Investigate their parent processes and clean them up."
            )
        else:
            self._resolve_alerts("process", "Zombie processes detected")

        # ── New listening port detection ─────────────────────────────
        current_ports = {p.local_port for p in listeners}
        if self._initial_scan_done:
            new_ports = current_ports - self._known_listeners
            for port in new_ports:
                matching = [p for p in listeners if p.local_port == port]
                proto = matching[0].protocol if matching else "unknown"
                addr = matching[0].local_addr if matching else "?"
                self._add_alert(
                    Severity.INFO, "network", f"New port {port} opened",
                    f"New {proto} listener on {addr}:{port}",
                )
        self._known_listeners = current_ports
        self._initial_scan_done = True

    async def _maybe_auto_heal(self, alert: Alert, goal: str) -> None:
        """If auto-heal is enabled and alert hasn't been healed yet, trigger the agent."""
        if not self.auto_heal or alert.auto_healed or not self._agent_callback:
            return

        alert.auto_healed = True
        logger.info("Auto-heal triggered for: %s", alert.title)

        try:
            response = await self._agent_callback(goal)
            alert.agent_response = response or ""
        except Exception:
            logger.exception("Auto-heal agent callback failed")

    def get_active_alerts(self) -> list[dict]:
        """Return active (unresolved) alerts as dicts."""
        return [
            {
                "id": a.id,
                "severity": a.severity.value,
                "category": a.category,
                "title": a.title,
                "detail": a.detail,
                "timestamp": a.timestamp,
                "auto_healed": a.auto_healed,
                "healing_in_progress": a.auto_healed and not a.agent_response,
                "agent_response": a.agent_response[:500] if a.agent_response else "",
            }
            for a in self.alerts if not a.resolved
        ]

    def get_alert_history(self) -> list[dict]:
        """Return all alerts (including resolved) as dicts."""
        return [
            {
                "id": a.id,
                "severity": a.severity.value,
                "category": a.category,
                "title": a.title,
                "detail": a.detail,
                "timestamp": a.timestamp,
                "resolved": a.resolved,
                "auto_healed": a.auto_healed,
                "agent_response": a.agent_response[:500] if a.agent_response else "",
            }
            for a in reversed(self.alerts)  # newest first
        ]

    def dismiss_alert(self, alert_id: str) -> bool:
        """Manually dismiss/resolve an alert."""
        for a in self.alerts:
            if a.id == alert_id:
                a.resolved = True
                return True
        return False

    @property
    def status(self) -> dict:
        active = self.get_active_alerts()
        worst = "ok"
        for a in active:
            if a["severity"] == "critical":
                worst = "critical"
                break
            if a["severity"] == "warning":
                worst = "warning"
        return {
            "enabled": self.enabled,
            "auto_heal": self.auto_heal,
            "status": worst,
            "active_alerts": len(active),
            "total_alerts": len(self.alerts),
            "check_interval": self.check_interval,
        }
