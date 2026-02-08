#include "agent_kernel/metrics.h"

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <sys/statvfs.h>
#include <mntent.h>
#include <cstring>
#include <thread>
#include <chrono>
#include <mutex>

namespace agent_kernel {

namespace {

uint64_t parse_kb(const std::string& line) {
    // Format: "MemTotal:       16384000 kB"
    std::istringstream iss(line);
    std::string label;
    uint64_t value;
    iss >> label >> value;
    return value;
}

struct CpuTicks {
    uint64_t user, nice, system, idle, iowait, irq, softirq, steal;

    uint64_t total() const {
        return user + nice + system + idle + iowait + irq + softirq + steal;
    }
    uint64_t active() const {
        return total() - idle - iowait;
    }
};

CpuTicks read_cpu_ticks() {
    std::ifstream f("/proc/stat");
    if (!f.is_open()) throw std::runtime_error("Cannot read /proc/stat");

    std::string label;
    CpuTicks t{};
    f >> label >> t.user >> t.nice >> t.system >> t.idle
      >> t.iowait >> t.irq >> t.softirq >> t.steal;
    return t;
}

} // anonymous namespace

CpuInfo SystemMetrics::cpu() {
    CpuInfo info{};

    // Cache previous tick sample to avoid a blocking sleep on every call.
    // First call still sleeps 100ms; subsequent calls compute delta vs last.
    // Mutex guards static state because the GIL is released on this method.
    static std::mutex mtx;
    static CpuTicks prev_ticks{};
    static bool has_prev = false;

    std::lock_guard<std::mutex> lock(mtx);

    if (!has_prev) {
        prev_ticks = read_cpu_ticks();
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    auto t2 = read_cpu_ticks();
    uint64_t total_diff = t2.total() - prev_ticks.total();
    uint64_t active_diff = t2.active() - prev_ticks.active();
    info.usage_percent = total_diff > 0
        ? (static_cast<double>(active_diff) / static_cast<double>(total_diff)) * 100.0
        : 0.0;
    prev_ticks = t2;
    has_prev = true;

    // Core count
    info.core_count = static_cast<int>(std::thread::hardware_concurrency());

    // Load averages from /proc/loadavg
    std::ifstream lf("/proc/loadavg");
    if (lf.is_open()) {
        lf >> info.load_1m >> info.load_5m >> info.load_15m;
    }

    return info;
}

MemInfo SystemMetrics::memory() {
    MemInfo info{};
    std::ifstream f("/proc/meminfo");
    if (!f.is_open()) throw std::runtime_error("Cannot read /proc/meminfo");

    std::string line;
    int found = 0;
    while (std::getline(f, line) && found < 4) {
        if (line.rfind("MemTotal:", 0) == 0)          { info.total_kb = parse_kb(line); ++found; }
        else if (line.rfind("MemAvailable:", 0) == 0)  { info.available_kb = parse_kb(line); ++found; }
        else if (line.rfind("SwapTotal:", 0) == 0)     { info.swap_total_kb = parse_kb(line); ++found; }
        else if (line.rfind("SwapFree:", 0) == 0)      { info.swap_used_kb = info.swap_total_kb - parse_kb(line); ++found; }
    }

    info.used_kb = info.total_kb - info.available_kb;
    info.usage_percent = info.total_kb > 0
        ? (static_cast<double>(info.used_kb) / static_cast<double>(info.total_kb)) * 100.0
        : 0.0;

    return info;
}

DiskInfo SystemMetrics::disk(const std::string& path) {
    struct statvfs stat{};
    if (statvfs(path.c_str(), &stat) != 0) {
        throw std::runtime_error("statvfs failed for: " + path);
    }

    DiskInfo info;
    info.mount_point = path;
    info.total_bytes = static_cast<uint64_t>(stat.f_blocks) * stat.f_frsize;
    info.available_bytes = static_cast<uint64_t>(stat.f_bavail) * stat.f_frsize;
    info.used_bytes = info.total_bytes - (static_cast<uint64_t>(stat.f_bfree) * stat.f_frsize);
    info.usage_percent = info.total_bytes > 0
        ? (static_cast<double>(info.used_bytes) / static_cast<double>(info.total_bytes)) * 100.0
        : 0.0;

    return info;
}

std::vector<DiskInfo> SystemMetrics::all_disks() {
    std::vector<DiskInfo> disks;
    FILE* fp = setmntent("/etc/mtab", "r");
    if (!fp) return disks;

    struct mntent* entry;
    while ((entry = getmntent(fp)) != nullptr) {
        // Only real filesystems
        if (std::strncmp(entry->mnt_fsname, "/dev/", 5) != 0) continue;
        try {
            disks.push_back(disk(entry->mnt_dir));
        } catch (...) {
            // Skip filesystems we can't stat
        }
    }
    endmntent(fp);
    return disks;
}

} // namespace agent_kernel
