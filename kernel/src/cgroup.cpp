#include "agent_kernel/cgroup.h"

#include <fstream>
#include <sstream>
#include <cstdlib>
#include <sys/stat.h>

namespace agent_kernel {

namespace {

std::string read_first_line(const std::string& path) {
    std::ifstream f(path);
    std::string line;
    if (f.is_open()) std::getline(f, line);
    return line;
}

int64_t read_int64(const std::string& path, int64_t fallback = -1) {
    std::string line = read_first_line(path);
    if (line.empty() || line == "max") return fallback;
    try {
        return std::stoll(line);
    } catch (...) {
        return fallback;
    }
}

bool file_exists(const std::string& path) {
    struct stat st;
    return stat(path.c_str(), &st) == 0;
}

int detect_cgroup_version() {
    // cgroup v2 has a unified hierarchy
    if (file_exists("/sys/fs/cgroup/cgroup.controllers")) return 2;
    // cgroup v1 has separate controllers
    if (file_exists("/sys/fs/cgroup/memory/memory.limit_in_bytes")) return 1;
    return 0;
}

} // anonymous namespace

bool CgroupManager::is_in_container() {
    // Check for Docker
    if (file_exists("/.dockerenv")) return true;

    // Check for container indicators in cgroup
    std::ifstream f("/proc/1/cgroup");
    if (!f.is_open()) return false;
    std::string line;
    while (std::getline(f, line)) {
        if (line.find("docker") != std::string::npos ||
            line.find("kubepods") != std::string::npos ||
            line.find("containerd") != std::string::npos ||
            line.find("lxc") != std::string::npos) {
            return true;
        }
    }

    // Check for container env
    return std::getenv("container") != nullptr;
}

CgroupInfo CgroupManager::info() {
    CgroupInfo cg{};
    cg.cgroup_version = detect_cgroup_version();
    cg.is_containerized = is_in_container();
    cg.memory_limit_bytes = -1;
    cg.memory_usage_bytes = -1;
    cg.cpu_quota = -1.0;
    cg.pids_limit = -1;
    cg.pids_current = -1;

    if (cg.cgroup_version == 2) {
        // cgroup v2 paths
        cg.memory_limit_bytes = read_int64("/sys/fs/cgroup/memory.max", -1);
        cg.memory_usage_bytes = read_int64("/sys/fs/cgroup/memory.current", -1);

        // cpu.max format: "$MAX $PERIOD" or "max $PERIOD"
        std::string cpu_max = read_first_line("/sys/fs/cgroup/cpu.max");
        if (!cpu_max.empty() && cpu_max.substr(0, 3) != "max") {
            std::istringstream iss(cpu_max);
            int64_t quota, period;
            iss >> quota >> period;
            if (period > 0) {
                cg.cpu_quota = static_cast<double>(quota) / static_cast<double>(period);
            }
        }

        cg.pids_limit = read_int64("/sys/fs/cgroup/pids.max", -1);
        cg.pids_current = read_int64("/sys/fs/cgroup/pids.current", -1);

    } else if (cg.cgroup_version == 1) {
        // cgroup v1 paths
        int64_t mem_limit = read_int64("/sys/fs/cgroup/memory/memory.limit_in_bytes", -1);
        // Huge value means unlimited (typically 9223372036854771712)
        if (mem_limit > 0 && mem_limit < (1LL << 60)) {
            cg.memory_limit_bytes = mem_limit;
        }
        cg.memory_usage_bytes = read_int64("/sys/fs/cgroup/memory/memory.usage_in_bytes", -1);

        int64_t cfs_quota = read_int64("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", -1);
        int64_t cfs_period = read_int64("/sys/fs/cgroup/cpu/cpu.cfs_period_us", 100000);
        if (cfs_quota > 0 && cfs_period > 0) {
            cg.cpu_quota = static_cast<double>(cfs_quota) / static_cast<double>(cfs_period);
        }

        cg.pids_limit = read_int64("/sys/fs/cgroup/pids/pids.max", -1);
        cg.pids_current = read_int64("/sys/fs/cgroup/pids/pids.current", -1);
    }

    return cg;
}

} // namespace agent_kernel
