#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "agent_kernel/metrics.h"
#include "agent_kernel/process.h"
#include "agent_kernel/fs_watcher.h"
#include "agent_kernel/sandbox.h"

namespace py = pybind11;
using namespace agent_kernel;

PYBIND11_MODULE(agent_kernel, m) {
    m.doc() = "AgentOS C++ kernel runtime — process management, filesystem watching, sandboxing, system metrics";

    // ── Metrics ─────────────────────────────────────────────────────────

    py::class_<CpuInfo>(m, "CpuInfo")
        .def_readonly("usage_percent", &CpuInfo::usage_percent)
        .def_readonly("core_count", &CpuInfo::core_count)
        .def_readonly("load_1m", &CpuInfo::load_1m)
        .def_readonly("load_5m", &CpuInfo::load_5m)
        .def_readonly("load_15m", &CpuInfo::load_15m);

    py::class_<MemInfo>(m, "MemInfo")
        .def_readonly("total_kb", &MemInfo::total_kb)
        .def_readonly("available_kb", &MemInfo::available_kb)
        .def_readonly("used_kb", &MemInfo::used_kb)
        .def_readonly("usage_percent", &MemInfo::usage_percent)
        .def_readonly("swap_total_kb", &MemInfo::swap_total_kb)
        .def_readonly("swap_used_kb", &MemInfo::swap_used_kb);

    py::class_<DiskInfo>(m, "DiskInfo")
        .def_readonly("mount_point", &DiskInfo::mount_point)
        .def_readonly("total_bytes", &DiskInfo::total_bytes)
        .def_readonly("used_bytes", &DiskInfo::used_bytes)
        .def_readonly("available_bytes", &DiskInfo::available_bytes)
        .def_readonly("usage_percent", &DiskInfo::usage_percent);

    py::class_<SystemMetrics>(m, "SystemMetrics")
        .def_static("cpu", &SystemMetrics::cpu, py::call_guard<py::gil_scoped_release>())
        .def_static("memory", &SystemMetrics::memory)
        .def_static("disk", &SystemMetrics::disk, py::arg("path") = "/")
        .def_static("all_disks", &SystemMetrics::all_disks);

    // ── Process Management ──────────────────────────────────────────────

    py::class_<ProcessInfo>(m, "ProcessInfo")
        .def_readonly("pid", &ProcessInfo::pid)
        .def_readonly("ppid", &ProcessInfo::ppid)
        .def_readonly("name", &ProcessInfo::name)
        .def_readonly("state", &ProcessInfo::state)
        .def_readonly("rss_kb", &ProcessInfo::rss_kb)
        .def_readonly("vsize_kb", &ProcessInfo::vsize_kb)
        .def_readonly("cpu_percent", &ProcessInfo::cpu_percent)
        .def_readonly("cmdline", &ProcessInfo::cmdline)
        .def_readonly("uid", &ProcessInfo::uid);

    py::class_<ResourceLimits>(m, "ResourceLimits")
        .def(py::init<>())
        .def_readwrite("max_cpu_seconds", &ResourceLimits::max_cpu_seconds)
        .def_readwrite("max_memory_bytes", &ResourceLimits::max_memory_bytes)
        .def_readwrite("max_file_size", &ResourceLimits::max_file_size)
        .def_readwrite("max_open_files", &ResourceLimits::max_open_files)
        .def_readwrite("max_processes", &ResourceLimits::max_processes);

    py::class_<ProcessManager>(m, "ProcessManager")
        .def_static("list_all", &ProcessManager::list_all)
        .def_static("get_info", &ProcessManager::get_info, py::arg("pid"))
        .def_static("send_signal", &ProcessManager::send_signal, py::arg("pid"), py::arg("signal"))
        .def_static("spawn", &ProcessManager::spawn, py::arg("command"), py::arg("limits") = ResourceLimits{});

    // ── Filesystem Watcher ──────────────────────────────────────────────

    py::enum_<FSEventType>(m, "FSEventType")
        .value("Created", FSEventType::Created)
        .value("Modified", FSEventType::Modified)
        .value("Deleted", FSEventType::Deleted)
        .value("Moved", FSEventType::Moved)
        .value("All", FSEventType::All);

    py::class_<FSEvent>(m, "FSEvent")
        .def_readonly("type", &FSEvent::type)
        .def_readonly("path", &FSEvent::path)
        .def_readonly("name", &FSEvent::name);

    py::class_<FSWatcher>(m, "FSWatcher")
        .def(py::init<>())
        .def("watch", &FSWatcher::watch, py::arg("path"), py::arg("mask") = static_cast<uint32_t>(FSEventType::All))
        .def("unwatch", &FSWatcher::unwatch, py::arg("wd"))
        .def("poll", &FSWatcher::poll, py::arg("timeout_ms") = 100, py::call_guard<py::gil_scoped_release>())
        .def("watch_count", &FSWatcher::watch_count);

    // ── Sandbox ─────────────────────────────────────────────────────────

    py::class_<SandboxPolicy>(m, "SandboxPolicy")
        .def(py::init<>())
        .def_readwrite("limits", &SandboxPolicy::limits)
        .def_readwrite("working_dir", &SandboxPolicy::working_dir)
        .def_readwrite("env", &SandboxPolicy::env)
        .def_readwrite("drop_privileges", &SandboxPolicy::drop_privileges)
        .def_readwrite("restrict_network", &SandboxPolicy::restrict_network);

    py::class_<ExecutionResult>(m, "ExecutionResult")
        .def_readonly("exit_code", &ExecutionResult::exit_code)
        .def_readonly("stdout_output", &ExecutionResult::stdout_output)
        .def_readonly("stderr_output", &ExecutionResult::stderr_output)
        .def_readonly("elapsed_seconds", &ExecutionResult::elapsed_seconds)
        .def_readonly("timed_out", &ExecutionResult::timed_out);

    py::class_<Sandbox>(m, "Sandbox")
        .def_static("run", &Sandbox::run, py::arg("command"), py::arg("policy") = SandboxPolicy{},
                     py::call_guard<py::gil_scoped_release>())
        .def_static("run_with_timeout", &Sandbox::run_with_timeout,
                     py::arg("command"), py::arg("timeout_seconds"), py::arg("policy") = SandboxPolicy{},
                     py::call_guard<py::gil_scoped_release>());
}
