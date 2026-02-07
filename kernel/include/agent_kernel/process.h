#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <sys/types.h>

namespace agent_kernel {

struct ProcessInfo {
    pid_t pid;
    pid_t ppid;
    std::string name;
    char state;            // R, S, D, Z, T, etc.
    uint64_t rss_kb;       // resident set size
    uint64_t vsize_kb;     // virtual memory size
    double cpu_percent;    // approximate
    std::string cmdline;
    uid_t uid;
};

struct ResourceLimits {
    int64_t max_cpu_seconds = -1;   // RLIMIT_CPU, -1 = unlimited
    int64_t max_memory_bytes = -1;  // RLIMIT_AS
    int64_t max_file_size = -1;     // RLIMIT_FSIZE
    int64_t max_open_files = 256;   // RLIMIT_NOFILE
    int64_t max_processes = 64;     // RLIMIT_NPROC
};

class ProcessManager {
public:
    /// List all running processes by reading /proc.
    static std::vector<ProcessInfo> list_all();

    /// Get info for a specific PID.
    static ProcessInfo get_info(pid_t pid);

    /// Send a signal to a process.
    static bool send_signal(pid_t pid, int signal);

    /// Spawn a command with optional resource limits. Returns child PID.
    static pid_t spawn(const std::string& command, const ResourceLimits& limits = {});
};

} // namespace agent_kernel
