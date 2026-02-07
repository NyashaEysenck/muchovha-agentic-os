#pragma once

#include <string>
#include <vector>
#include "process.h"

namespace agent_kernel {

struct SandboxPolicy {
    ResourceLimits limits;
    std::string working_dir = "/tmp";
    std::vector<std::string> env;          // KEY=VALUE pairs
    bool drop_privileges = true;           // setuid to nobody
    bool restrict_network = false;         // (future: network namespaces)
};

struct ExecutionResult {
    int exit_code;
    std::string stdout_output;
    std::string stderr_output;
    double elapsed_seconds;
    bool timed_out;
};

/// Sandboxed command execution with resource limits.
class Sandbox {
public:
    /// Run a command in a sandboxed environment.
    static ExecutionResult run(const std::string& command, const SandboxPolicy& policy = {});

    /// Run with a hard timeout in seconds.
    static ExecutionResult run_with_timeout(
        const std::string& command,
        int timeout_seconds,
        const SandboxPolicy& policy = {}
    );
};

} // namespace agent_kernel
