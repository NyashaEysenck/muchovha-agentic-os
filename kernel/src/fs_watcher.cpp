#include "agent_kernel/fs_watcher.h"

#include <sys/inotify.h>
#include <unistd.h>
#include <poll.h>

#include <stdexcept>
#include <cstring>
#include <cerrno>

namespace agent_kernel {

namespace {

uint32_t event_type_to_inotify(uint32_t mask) {
    uint32_t flags = 0;
    if (mask & static_cast<uint32_t>(FSEventType::Created))  flags |= IN_CREATE;
    if (mask & static_cast<uint32_t>(FSEventType::Modified)) flags |= IN_MODIFY | IN_CLOSE_WRITE;
    if (mask & static_cast<uint32_t>(FSEventType::Deleted))  flags |= IN_DELETE;
    if (mask & static_cast<uint32_t>(FSEventType::Moved))    flags |= IN_MOVED_FROM | IN_MOVED_TO;
    return flags;
}

FSEventType inotify_to_event_type(uint32_t mask) {
    if (mask & (IN_CREATE))                     return FSEventType::Created;
    if (mask & (IN_MODIFY | IN_CLOSE_WRITE))    return FSEventType::Modified;
    if (mask & (IN_DELETE))                      return FSEventType::Deleted;
    if (mask & (IN_MOVED_FROM | IN_MOVED_TO))   return FSEventType::Moved;
    return FSEventType::Modified; // fallback
}

} // anonymous namespace

FSWatcher::FSWatcher() {
    inotify_fd_ = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
    if (inotify_fd_ < 0) {
        throw std::runtime_error(std::string("inotify_init1 failed: ") + strerror(errno));
    }
}

FSWatcher::~FSWatcher() {
    for (auto& [wd, _] : watch_paths_) {
        inotify_rm_watch(inotify_fd_, wd);
    }
    close(inotify_fd_);
}

int FSWatcher::watch(const std::string& path, uint32_t mask) {
    uint32_t flags = event_type_to_inotify(mask);
    int wd = inotify_add_watch(inotify_fd_, path.c_str(), flags);
    if (wd < 0) {
        throw std::runtime_error("inotify_add_watch failed for " + path + ": " + strerror(errno));
    }
    watch_paths_[wd] = path;
    return wd;
}

void FSWatcher::unwatch(int wd) {
    inotify_rm_watch(inotify_fd_, wd);
    watch_paths_.erase(wd);
}

std::vector<FSEvent> FSWatcher::poll(int timeout_ms) {
    std::vector<FSEvent> events;

    struct pollfd pfd{};
    pfd.fd = inotify_fd_;
    pfd.events = POLLIN;

    int ret = ::poll(&pfd, 1, timeout_ms);
    if (ret <= 0) return events;

    // Read all available events
    alignas(struct inotify_event) char buf[4096];
    ssize_t len = read(inotify_fd_, buf, sizeof(buf));
    if (len <= 0) return events;

    for (char* ptr = buf; ptr < buf + len; ) {
        auto* ev = reinterpret_cast<struct inotify_event*>(ptr);

        FSEvent fse;
        fse.type = inotify_to_event_type(ev->mask);
        fse.name = (ev->len > 0) ? std::string(ev->name) : "";

        auto it = watch_paths_.find(ev->wd);
        fse.path = (it != watch_paths_.end()) ? it->second : "";

        events.push_back(std::move(fse));
        ptr += sizeof(struct inotify_event) + ev->len;
    }

    return events;
}

size_t FSWatcher::watch_count() const noexcept {
    return watch_paths_.size();
}

} // namespace agent_kernel
