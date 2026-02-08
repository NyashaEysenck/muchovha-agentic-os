#include "agent_kernel/network.h"

#include <fstream>
#include <sstream>
#include <cstdio>
#include <cstring>
#include <arpa/inet.h>
#include <stdexcept>

namespace agent_kernel {

namespace {

const char* tcp_state_name(int state) {
    switch (state) {
        case 0x01: return "ESTABLISHED";
        case 0x02: return "SYN_SENT";
        case 0x03: return "SYN_RECV";
        case 0x04: return "FIN_WAIT1";
        case 0x05: return "FIN_WAIT2";
        case 0x06: return "TIME_WAIT";
        case 0x07: return "CLOSE";
        case 0x08: return "CLOSE_WAIT";
        case 0x09: return "LAST_ACK";
        case 0x0A: return "LISTEN";
        case 0x0B: return "CLOSING";
        default:   return "UNKNOWN";
    }
}

std::string hex_to_ipv4(const std::string& hex_ip) {
    unsigned long addr = std::stoul(hex_ip, nullptr, 16);
    char buf[INET_ADDRSTRLEN];
    struct in_addr in;
    in.s_addr = static_cast<in_addr_t>(addr);
    inet_ntop(AF_INET, &in, buf, sizeof(buf));
    return buf;
}

std::string hex_to_ipv6(const std::string& hex_ip) {
    if (hex_ip.size() != 32) return hex_ip;
    struct in6_addr in;
    for (int i = 0; i < 4; ++i) {
        std::string chunk = hex_ip.substr(i * 8, 8);
        uint32_t val = static_cast<uint32_t>(std::stoul(chunk, nullptr, 16));
        // /proc/net/tcp6 stores 32-bit words in host byte order;
        // inet_ntop expects network byte order, so swap.
        val = htonl(val);
        std::memcpy(&in.s6_addr[i * 4], &val, 4);
    }
    char buf[INET6_ADDRSTRLEN];
    inet_ntop(AF_INET6, &in, buf, sizeof(buf));
    return buf;
}

std::vector<ConnectionInfo> parse_proc_net(const std::string& path, const std::string& protocol) {
    std::vector<ConnectionInfo> conns;
    std::ifstream f(path);
    if (!f.is_open()) return conns;

    bool is_v6 = (protocol == "tcp6" || protocol == "udp6");
    bool is_udp = (protocol == "udp" || protocol == "udp6");

    std::string line;
    std::getline(f, line); // skip header

    while (std::getline(f, line)) {
        try {
            std::istringstream iss(line);
            std::string sl, local, remote, state_hex;
            iss >> sl >> local >> remote >> state_hex;

            if (sl.empty() || local.empty()) continue;

            ConnectionInfo ci;
            ci.protocol = protocol;

            // Parse local address:port
            auto colon = local.rfind(':');
            if (colon == std::string::npos) continue;
            std::string local_ip = local.substr(0, colon);
            ci.local_port = static_cast<uint16_t>(std::stoul(local.substr(colon + 1), nullptr, 16));
            ci.local_addr = is_v6 ? hex_to_ipv6(local_ip) : hex_to_ipv4(local_ip);

            // Parse remote address:port
            colon = remote.rfind(':');
            if (colon == std::string::npos) continue;
            std::string remote_ip = remote.substr(0, colon);
            ci.remote_port = static_cast<uint16_t>(std::stoul(remote.substr(colon + 1), nullptr, 16));
            ci.remote_addr = is_v6 ? hex_to_ipv6(remote_ip) : hex_to_ipv4(remote_ip);

            int state_val = static_cast<int>(std::stoul(state_hex, nullptr, 16));
            ci.state = is_udp ? (state_val == 0x07 ? "CLOSE" : "ESTABLISHED") : tcp_state_name(state_val);

            // Remaining fields: tx_queue:rx_queue tr:tm->when retrnsmt uid
            std::string skip;
            iss >> skip >> skip >> skip; // tx_queue:rx_queue, tr:tm->when, retrnsmt
            iss >> ci.uid;
            // timeout inode
            std::string timeout_s;
            iss >> timeout_s >> ci.inode;

            conns.push_back(std::move(ci));
        } catch (...) {
            // Skip malformed lines
            continue;
        }
    }
    return conns;
}

} // anonymous namespace

std::vector<ConnectionInfo> NetworkMonitor::connections(const std::string& protocol) {
    return parse_proc_net("/proc/net/" + protocol, protocol);
}

std::vector<ConnectionInfo> NetworkMonitor::listening_ports() {
    std::vector<ConnectionInfo> result;

    for (const auto& proto : {"tcp", "tcp6", "udp", "udp6"}) {
        auto conns = connections(proto);
        for (auto& c : conns) {
            if (c.state == "LISTEN" || (c.remote_port == 0 &&
                (c.protocol == "udp" || c.protocol == "udp6"))) {
                result.push_back(std::move(c));
            }
        }
    }
    return result;
}

std::vector<InterfaceStats> NetworkMonitor::interfaces() {
    std::vector<InterfaceStats> ifaces;
    std::ifstream f("/proc/net/dev");
    if (!f.is_open()) return ifaces;

    std::string line;
    std::getline(f, line); // header 1
    std::getline(f, line); // header 2

    while (std::getline(f, line)) {
        // Format: "  iface: rx_bytes rx_packets rx_errs rx_drop ... tx_bytes tx_packets ..."
        auto colon = line.find(':');
        if (colon == std::string::npos) continue;

        InterfaceStats st;
        // Trim whitespace from name
        std::string name = line.substr(0, colon);
        size_t start = name.find_first_not_of(' ');
        st.name = (start != std::string::npos) ? name.substr(start) : name;

        std::istringstream iss(line.substr(colon + 1));
        uint64_t skip;
        // RX: bytes packets errs drop fifo frame compressed multicast
        iss >> st.rx_bytes >> st.rx_packets >> st.rx_errors >> st.rx_dropped
            >> skip >> skip >> skip >> skip;
        // TX: bytes packets errs drop fifo colls carrier compressed
        iss >> st.tx_bytes >> st.tx_packets >> st.tx_errors >> st.tx_dropped;

        ifaces.push_back(std::move(st));
    }
    return ifaces;
}

} // namespace agent_kernel
