#pragma once

#include <cstdint>
#include <string>

namespace agent_kernel {

struct CgroupInfo {
    int cgroup_version;            // 1 or 2, 0 if unknown
    bool is_containerized;

    // Memory
    int64_t memory_limit_bytes;    // -1 if unlimited
    int64_t memory_usage_bytes;    // -1 if unavailable

    // CPU
    double cpu_quota;              // Number of cores (e.g. 2.0), -1 if unlimited

    // PIDs
    int64_t pids_limit;            // -1 if unlimited
    int64_t pids_current;          // -1 if unavailable
};

class CgroupManager {
public:
    /// Read cgroup limits and usage for the current process.
    static CgroupInfo info();

    /// Quick check: are we inside a container?
    static bool is_in_container();
};

} // namespace agent_kernel
