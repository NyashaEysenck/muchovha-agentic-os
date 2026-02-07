---
name: network-debug
description: Diagnose network connectivity issues — DNS resolution, port scanning, HTTP requests, routing, firewall rules. Use when the user has networking problems.
---

# Network Debug

## When to use
Use this skill when the user needs to:
- Test connectivity (ping, traceroute)
- Debug DNS resolution
- Check open ports and listening services
- Make HTTP requests
- Diagnose firewall issues
- Inspect network interfaces

## Connectivity

### Basic tests
```bash
ping -c 4 8.8.8.8                # test raw connectivity
ping -c 4 google.com             # test DNS + connectivity
traceroute google.com            # trace path
mtr --report google.com          # combined ping + traceroute
```

### DNS
```bash
nslookup example.com
dig example.com
dig +short example.com A
host example.com
cat /etc/resolv.conf              # DNS config
```

## Ports and services

### Check listening ports
```bash
ss -tlnp                         # TCP listeners
ss -ulnp                         # UDP listeners
netstat -tlnp                    # alternative
lsof -i :80                      # what's on port 80
```

### Test remote ports
```bash
nc -zv host 80                   # check if port is open
curl -v http://host:port         # HTTP test
timeout 3 bash -c 'echo > /dev/tcp/host/port' && echo "open"
```

## Network interfaces
```bash
ip addr show                     # all interfaces
ip route show                    # routing table
ip link show                     # link status
ifconfig                         # legacy
```

## HTTP debugging
```bash
curl -v https://example.com               # verbose
curl -o /dev/null -s -w '%{http_code}' URL # status code only
curl -H "Content-Type: application/json" -d '{}' URL
wget --spider URL                          # check if URL exists
```

## Firewall
```bash
sudo iptables -L -n -v           # list rules
sudo ufw status                  # UFW status
sudo ufw allow 80/tcp            # allow port
```

## Common issues
- **Connection refused**: Service not running on target port
- **Connection timed out**: Firewall blocking, wrong IP, or host down
- **Name resolution failed**: DNS misconfigured, check `/etc/resolv.conf`
- **Network unreachable**: Routing issue, check `ip route`
