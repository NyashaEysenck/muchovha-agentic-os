---
name: system-monitor
description: Monitor system resources — CPU, memory, disk, processes, load averages. Use when the user asks about performance, resource usage, or system health.
---

# System Monitor

## When to use
Use this skill when the user asks about:
- CPU usage or load averages
- Memory consumption or swap usage
- Disk space
- Running processes and resource hogs
- System performance diagnostics

## How to monitor

### Quick overview
Use the `system_info` tool for an instant snapshot of CPU, memory, and disk.

### Detailed CPU analysis
```bash
# Real-time CPU per core
mpstat -P ALL 1 3

# Top CPU consumers
ps aux --sort=-%cpu | head -20
```

### Memory analysis
```bash
# Detailed memory breakdown
free -h
cat /proc/meminfo | head -20

# Top memory consumers
ps aux --sort=-%mem | head -20
```

### Disk analysis
```bash
# Disk usage by mount point
df -h

# Largest directories
du -sh /* 2>/dev/null | sort -rh | head -10
```

### Process investigation
Use the `process_list` tool, or for specific processes:
```bash
# Process tree
pstree -p

# Specific process details
ps -p <PID> -o pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,command
```

## Common issues
- **High CPU**: Check for runaway processes with `top` or `htop`
- **Low memory**: Look for memory leaks, consider `swapoff -a && swapon -a`
- **Disk full**: Find large files with `find / -size +100M -type f 2>/dev/null`
- **High load average**: Load > core count means saturation. Check I/O wait with `iostat`
