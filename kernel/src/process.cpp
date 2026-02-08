#include "agent_kernel/process.h"

#include <dirent.h>
#include <signal.h>
#include <unistd.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <functional>
#include <unordered_map>
#include <cstring>
#include <cerrno>

namespace agent_kernel {

namespace {

bool is_pid_dir(const char* name) {
    for (const char* p = name; *p; ++p) {
        if (*p < '0' || *p > '9') return false;
    }
    return *name != '\0';
}

std::string read_file(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) return {};
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

ProcessInfo parse_proc(pid_t pid) {
    ProcessInfo info{};
    info.pid = pid;

    // /proc/pid/stat — space-delimited, field 2 is (name) in parens
    std::string stat_content = read_file("/proc/" + std::to_string(pid) + "/stat");
    if (stat_content.empty()) {
        info.name = "?";
        return info;
    }

    // Find the command name between first '(' and last ')'
    auto open = stat_content.find('(');
    auto close = stat_content.rfind(')');
    if (open != std::string::npos && close != std::string::npos && close > open) {
        info.name = stat_content.substr(open + 1, close - open - 1);
    }

    // Fields after the closing paren
    std::istringstream rest(stat_content.substr(close + 2));
    std::string field;

    // field 3: state
    rest >> field; info.state = field.empty() ? '?' : field[0];
    // field 4: ppid
    rest >> info.ppid;

    // Skip fields 5-22 to reach field 23 (vsize) and 24 (rss in pages)
    for (int i = 5; i <= 22; ++i) rest >> field;
    uint64_t vsize_bytes = 0, rss_pages = 0;
    rest >> vsize_bytes >> rss_pages;
    info.vsize_kb = vsize_bytes / 1024;
    info.rss_kb = (rss_pages * static_cast<uint64_t>(sysconf(_SC_PAGESIZE))) / 1024;
    info.cpu_percent = 0.0; // Accurate per-process CPU requires two samples; leave as 0

    // /proc/pid/cmdline — null-separated
    std::string cmdline = read_file("/proc/" + std::to_string(pid) + "/cmdline");
    for (auto& c : cmdline) {
        if (c == '\0') c = ' ';
    }
    if (!cmdline.empty() && cmdline.back() == ' ') cmdline.pop_back();
    info.cmdline = cmdline.empty() ? ("[" + info.name + "]") : cmdline;

    // Get UID via stat() on /proc/pid — avoids opening a third file
    struct stat proc_stat;
    std::string proc_path = "/proc/" + std::to_string(pid);
    if (::stat(proc_path.c_str(), &proc_stat) == 0) {
        info.uid = proc_stat.st_uid;
    }

    return info;
}

bool apply_rlimit(int resource, int64_t value) {
    if (value < 0) return true;  // unlimited
    struct rlimit rl;
    rl.rlim_cur = static_cast<rlim_t>(value);
    rl.rlim_max = static_cast<rlim_t>(value);
    return setrlimit(resource, &rl) == 0;
}

} // anonymous namespace

std::vector<ProcessInfo> ProcessManager::list_all() {
    std::vector<ProcessInfo> procs;
    DIR* dir = opendir("/proc");
    if (!dir) return procs;

    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        if (!is_pid_dir(entry->d_name)) continue;
        pid_t pid = static_cast<pid_t>(std::stoi(entry->d_name));
        try {
            procs.push_back(parse_proc(pid));
        } catch (...) {
            // Process may have exited between readdir and reading /proc
        }
    }
    closedir(dir);
    return procs;
}

ProcessInfo ProcessManager::get_info(pid_t pid) {
    return parse_proc(pid);
}

bool ProcessManager::send_signal(pid_t pid, int sig) {
    return kill(pid, sig) == 0;
}

std::vector<ProcessInfo> ProcessManager::children(pid_t parent_pid) {
    auto all = list_all();
    std::vector<ProcessInfo> result;
    for (auto& p : all) {
        if (p.ppid == parent_pid) {
            result.push_back(std::move(p));
        }
    }
    return result;
}

std::vector<ProcessTreeNode> ProcessManager::tree() {
    auto all = list_all();

    // Build parent->children map
    std::unordered_map<pid_t, std::vector<size_t>> child_map;
    std::unordered_map<pid_t, size_t> idx_map;
    for (size_t i = 0; i < all.size(); ++i) {
        idx_map[all[i].pid] = i;
        child_map[all[i].ppid].push_back(i);
    }

    // DFS from root processes (ppid=0 or ppid not in list)
    std::vector<ProcessTreeNode> result;
    result.reserve(all.size());

    std::function<void(pid_t, int)> dfs = [&](pid_t pid, int depth) {
        auto it = idx_map.find(pid);
        if (it == idx_map.end()) return;
        result.push_back({std::move(all[it->second]), depth});
        auto cit = child_map.find(pid);
        if (cit != child_map.end()) {
            for (size_t ci : cit->second) {
                dfs(all[ci].pid, depth + 1);
            }
        }
    };

    // Find root processes
    for (auto& p : all) {
        if (p.ppid == 0 || idx_map.find(p.ppid) == idx_map.end()) {
            dfs(p.pid, 0);
        }
    }

    return result;
}

pid_t ProcessManager::spawn(const std::string& command, const ResourceLimits& limits) {
    pid_t pid = fork();
    if (pid < 0) {
        throw std::runtime_error(std::string("fork failed: ") + strerror(errno));
    }

    if (pid == 0) {
        // Child process: apply resource limits
        apply_rlimit(RLIMIT_CPU, limits.max_cpu_seconds);
        apply_rlimit(RLIMIT_AS, limits.max_memory_bytes);
        apply_rlimit(RLIMIT_FSIZE, limits.max_file_size);
        apply_rlimit(RLIMIT_NOFILE, limits.max_open_files);
        apply_rlimit(RLIMIT_NPROC, limits.max_processes);

        // Execute via shell
        execl("/bin/sh", "sh", "-c", command.c_str(), nullptr);
        _exit(127); // exec failed
    }

    return pid;
}

} // namespace agent_kernel
