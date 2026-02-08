#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace agent_kernel {

struct ConnectionInfo {
    std::string protocol;    // "tcp", "tcp6", "udp", "udp6"
    std::string local_addr;
    uint16_t local_port;
    std::string remote_addr;
    uint16_t remote_port;
    std::string state;       // ESTABLISHED, LISTEN, TIME_WAIT, etc.
    int uid;
    uint64_t inode;
};

struct InterfaceStats {
    std::string name;
    uint64_t rx_bytes;
    uint64_t tx_bytes;
    uint64_t rx_packets;
    uint64_t tx_packets;
    uint64_t rx_errors;
    uint64_t tx_errors;
    uint64_t rx_dropped;
    uint64_t tx_dropped;
};

class NetworkMonitor {
public:
    /// List all connections for a given protocol (tcp, tcp6, udp, udp6).
    static std::vector<ConnectionInfo> connections(const std::string& protocol = "tcp");

    /// List only listening ports.
    static std::vector<ConnectionInfo> listening_ports();

    /// Get interface statistics from /proc/net/dev.
    static std::vector<InterfaceStats> interfaces();
};

} // namespace agent_kernel
