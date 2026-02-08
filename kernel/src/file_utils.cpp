#include "agent_kernel/file_utils.h"

#include <dirent.h>
#include <fnmatch.h>
#include <sys/stat.h>

#include <algorithm>
#include <fstream>
#include <functional>
#include <stdexcept>
#include <vector>

namespace agent_kernel {

namespace {

void search_recursive(
    const std::string& dir,
    const std::string& pattern,
    int depth,
    int max_depth,
    int max_results,
    std::vector<FileSearchResult>& results
) {
    if (depth > max_depth || static_cast<int>(results.size()) >= max_results) return;

    DIR* d = opendir(dir.c_str());
    if (!d) return;

    struct dirent* entry;
    while ((entry = readdir(d)) != nullptr) {
        if (static_cast<int>(results.size()) >= max_results) break;

        const char* name = entry->d_name;
        if (name[0] == '.' && (name[1] == '\0' || (name[1] == '.' && name[2] == '\0')))
            continue;

        std::string full_path = dir + "/" + name;

        struct stat st;
        if (lstat(full_path.c_str(), &st) != 0) continue;

        bool is_dir = S_ISDIR(st.st_mode);

        // Match against pattern
        if (fnmatch(pattern.c_str(), name, FNM_CASEFOLD) == 0) {
            FileSearchResult r;
            r.path = full_path;
            r.size = is_dir ? 0 : static_cast<uint64_t>(st.st_size);
            r.is_dir = is_dir;
            results.push_back(std::move(r));
        }

        // Recurse into directories (skip symlinks to avoid loops)
        if (is_dir && !S_ISLNK(st.st_mode)) {
            search_recursive(full_path, pattern, depth + 1, max_depth, max_results, results);
        }
    }
    closedir(d);
}

} // anonymous namespace

std::vector<FileSearchResult> FileUtils::search(
    const std::string& root,
    const std::string& pattern,
    int max_depth,
    int max_results
) {
    std::vector<FileSearchResult> results;
    results.reserve(std::min(max_results, 256));
    search_recursive(root, pattern, 0, max_depth, max_results, results);
    return results;
}

std::string FileUtils::tail(const std::string& path, int lines) {
    std::ifstream f(path, std::ios::ate | std::ios::binary);
    if (!f.is_open()) {
        throw std::runtime_error("Cannot open file: " + path);
    }

    auto size = f.tellg();
    if (size == std::streampos(0)) return "";

    // Read backwards to find enough newlines
    int newline_count = 0;
    std::streampos pos = size;
    const std::streamsize chunk_size = 4096;
    std::string result;

    while (pos > std::streampos(0) && newline_count <= lines) {
        auto read_size = std::min(static_cast<std::streamsize>(pos), chunk_size);
        pos -= read_size;
        f.seekg(pos);

        std::string chunk(static_cast<size_t>(read_size), '\0');
        f.read(&chunk[0], read_size);
        result = chunk + result;

        for (char c : chunk) {
            if (c == '\n') ++newline_count;
        }
    }

    // Trim to last N lines
    if (newline_count > lines) {
        int skip = newline_count - lines;
        size_t idx = 0;
        for (int i = 0; i < skip && idx < result.size(); ++i) {
            idx = result.find('\n', idx);
            if (idx == std::string::npos) break;
            ++idx;
        }
        if (idx < result.size()) {
            result = result.substr(idx);
        }
    }

    // Cap output at 64KB
    if (result.size() > 65536) {
        result = result.substr(result.size() - 65536);
    }

    return result;
}

uint64_t FileUtils::dir_size(const std::string& path) {
    uint64_t total = 0;
    DIR* d = opendir(path.c_str());
    if (!d) return 0;

    struct dirent* entry;
    while ((entry = readdir(d)) != nullptr) {
        const char* name = entry->d_name;
        if (name[0] == '.' && (name[1] == '\0' || (name[1] == '.' && name[2] == '\0')))
            continue;

        std::string full = path + "/" + name;
        struct stat st;
        if (lstat(full.c_str(), &st) != 0) continue;

        if (S_ISDIR(st.st_mode) && !S_ISLNK(st.st_mode)) {
            total += dir_size(full);
        } else if (S_ISREG(st.st_mode)) {
            total += static_cast<uint64_t>(st.st_size);
        }
    }
    closedir(d);
    return total;
}

} // namespace agent_kernel
