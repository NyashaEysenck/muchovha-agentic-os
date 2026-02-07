#include "agent_kernel/sandbox.h"

#include <unistd.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <signal.h>

#include <array>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <stdexcept>
#include <thread>

namespace agent_kernel {

namespace {

void apply_rlimit(int resource, int64_t value) {
    if (value < 0) return;
    struct rlimit rl;
    rl.rlim_cur = static_cast<rlim_t>(value);
    rl.rlim_max = static_cast<rlim_t>(value);
    setrlimit(resource, &rl);
}

std::string read_pipe(int fd) {
    std::string result;
    char buf[4096];
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf))) > 0) {
        result.append(buf, static_cast<size_t>(n));
    }
    return result;
}

} // anonymous namespace

ExecutionResult Sandbox::run(const std::string& command, const SandboxPolicy& policy) {
    return run_with_timeout(command, 0, policy);
}

ExecutionResult Sandbox::run_with_timeout(
    const std::string& command,
    int timeout_seconds,
    const SandboxPolicy& policy
) {
    int stdout_pipe[2], stderr_pipe[2];
    if (pipe(stdout_pipe) != 0 || pipe(stderr_pipe) != 0) {
        throw std::runtime_error(std::string("pipe failed: ") + strerror(errno));
    }

    auto start = std::chrono::steady_clock::now();

    pid_t pid = fork();
    if (pid < 0) {
        throw std::runtime_error(std::string("fork failed: ") + strerror(errno));
    }

    if (pid == 0) {
        // Child: redirect stdout/stderr to pipes
        close(stdout_pipe[0]);
        close(stderr_pipe[0]);
        dup2(stdout_pipe[1], STDOUT_FILENO);
        dup2(stderr_pipe[1], STDERR_FILENO);
        close(stdout_pipe[1]);
        close(stderr_pipe[1]);

        // Apply resource limits
        const auto& lim = policy.limits;
        apply_rlimit(RLIMIT_CPU, lim.max_cpu_seconds);
        apply_rlimit(RLIMIT_AS, lim.max_memory_bytes);
        apply_rlimit(RLIMIT_FSIZE, lim.max_file_size);
        apply_rlimit(RLIMIT_NOFILE, lim.max_open_files);
        apply_rlimit(RLIMIT_NPROC, lim.max_processes);

        // Change working directory
        if (!policy.working_dir.empty()) {
            if (chdir(policy.working_dir.c_str()) != 0) {
                _exit(126);
            }
        }

        // Set environment variables
        for (const auto& env : policy.env) {
            putenv(const_cast<char*>(env.c_str()));
        }

        execl("/bin/sh", "sh", "-c", command.c_str(), nullptr);
        _exit(127);
    }

    // Parent: read output and wait
    close(stdout_pipe[1]);
    close(stderr_pipe[1]);

    ExecutionResult result{};
    result.timed_out = false;

    // If timeout is set, monitor the child
    if (timeout_seconds > 0) {
        auto deadline = start + std::chrono::seconds(timeout_seconds);
        int status = 0;
        bool exited = false;

        while (std::chrono::steady_clock::now() < deadline) {
            pid_t w = waitpid(pid, &status, WNOHANG);
            if (w > 0) {
                exited = true;
                result.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }

        if (!exited) {
            kill(pid, SIGKILL);
            waitpid(pid, &status, 0);
            result.timed_out = true;
            result.exit_code = -1;
        }
    } else {
        int status = 0;
        waitpid(pid, &status, 0);
        result.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    }

    result.stdout_output = read_pipe(stdout_pipe[0]);
    result.stderr_output = read_pipe(stderr_pipe[0]);
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);

    auto end = std::chrono::steady_clock::now();
    result.elapsed_seconds = std::chrono::duration<double>(end - start).count();

    return result;
}

} // namespace agent_kernel
