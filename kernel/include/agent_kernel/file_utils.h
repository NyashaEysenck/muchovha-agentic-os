#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace agent_kernel {

struct FileSearchResult {
    std::string path;
    uint64_t size;
    bool is_dir;
};

class FileUtils {
public:
    /// Recursive glob search. Returns matching paths up to max_results.
    static std::vector<FileSearchResult> search(
        const std::string& root,
        const std::string& pattern,
        int max_depth = 10,
        int max_results = 200
    );

    /// Read the last N lines of a file efficiently.
    static std::string tail(const std::string& path, int lines = 50);

    /// Recursively compute directory size in bytes.
    static uint64_t dir_size(const std::string& path);
};

} // namespace agent_kernel
