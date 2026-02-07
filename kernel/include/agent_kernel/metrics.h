#pragma once

#include <string>
#include <vector>

namespace agent_kernel {

struct CpuInfo {
    double usage_percent;
    int core_count;
    double load_1m;
    double load_5m;
    double load_15m;
};

struct MemInfo {
    uint64_t total_kb;
    uint64_t available_kb;
    uint64_t used_kb;
    double usage_percent;
    uint64_t swap_total_kb;
    uint64_t swap_used_kb;
};

struct DiskInfo {
    std::string mount_point;
    uint64_t total_bytes;
    uint64_t used_bytes;
    uint64_t available_bytes;
    double usage_percent;
};

class SystemMetrics {
public:
    static CpuInfo cpu();
    static MemInfo memory();
    static DiskInfo disk(const std::string& path = "/");
    static std::vector<DiskInfo> all_disks();
};

} // namespace agent_kernel
