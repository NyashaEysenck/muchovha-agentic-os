#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <functional>
#include <unordered_map>

namespace agent_kernel {

enum class FSEventType : uint32_t {
    Created  = 0x01,
    Modified = 0x02,
    Deleted  = 0x04,
    Moved    = 0x08,
    All      = 0x0F,
};

struct FSEvent {
    FSEventType type;
    std::string path;
    std::string name;
};

/// inotify-based filesystem watcher.
class FSWatcher {
public:
    FSWatcher();
    ~FSWatcher();

    FSWatcher(const FSWatcher&) = delete;
    FSWatcher& operator=(const FSWatcher&) = delete;

    /// Add a directory to watch. Returns watch descriptor.
    int watch(const std::string& path, uint32_t mask = static_cast<uint32_t>(FSEventType::All));

    /// Remove a watch by descriptor.
    void unwatch(int wd);

    /// Poll for events with timeout in milliseconds. Returns collected events.
    std::vector<FSEvent> poll(int timeout_ms = 100);

    /// Number of active watches.
    size_t watch_count() const noexcept;

private:
    int inotify_fd_;
    std::unordered_map<int, std::string> watch_paths_;
};

} // namespace agent_kernel
