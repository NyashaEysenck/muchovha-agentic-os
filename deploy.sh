#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# MuchovhaOS — Deploy script (runs ON the EC2 instance)
# Usage: chmod +x deploy.sh && ./deploy.sh
# ═══════════════════════════════════════════════════════════════
set -e

echo "══════════════════════════════════════"
echo "  MuchovhaOS Deployment"
echo "══════════════════════════════════════"

# ── 1. Swap (critical for small instances) ──
if [ ! -f /swapfile ]; then
    echo "[1/5] Creating 2 GB swap..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
    echo "  ✓ Swap enabled"
else
    echo "[1/5] Swap already exists, skipping"
fi

# ── 2. Install Docker ──
if ! command -v docker &> /dev/null; then
    echo "[2/5] Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    echo "  ✓ Docker installed"
else
    echo "[2/5] Docker already installed, skipping"
fi

# ── 3. Check for API key ──
if [ ! -f .env ]; then
    echo ""
    read -p "Enter your GEMINI_API_KEY: " api_key
    echo "GEMINI_API_KEY=$api_key" > .env
    echo "  ✓ .env created"
else
    echo "[3/5] .env found"
fi

# ── 4. Build and run ──
echo "[4/5] Building and starting MuchovhaOS..."
sudo docker build -t muchovhaos .
sudo docker run -d \
    --name muchovhaos \
    --restart unless-stopped \
    --env-file .env \
    --privileged \
    -p 80:8000 \
    muchovhaos

# ── 5. Cloudflare Tunnel (HTTPS) ──
echo "[5/5] Setting up HTTPS tunnel..."

if ! command -v cloudflared &> /dev/null; then
    sudo curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
        -o /usr/local/bin/cloudflared
    sudo chmod +x /usr/local/bin/cloudflared
    echo "  ✓ cloudflared installed"
else
    echo "  cloudflared already installed"
fi

# Stop existing tunnel if running
sudo systemctl stop cloudflared 2>/dev/null || true

# Create systemd service for the tunnel
sudo tee /etc/systemd/system/cloudflared.service > /dev/null <<'EOF'
[Unit]
Description=Cloudflare Quick Tunnel (MuchovhaOS HTTPS)
After=network.target docker.service

[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --url http://localhost:80
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

# Clear old tunnel logs so we only get the fresh URL
sudo journalctl --rotate 2>/dev/null || true
sudo journalctl --vacuum-time=1s -u cloudflared 2>/dev/null || true

# Wait for the tunnel URL to appear in logs
echo "  Waiting for HTTPS URL..."
HTTPS_URL=""
for i in $(seq 1 20); do
    HTTPS_URL=$(sudo journalctl -u cloudflared --since "30 seconds ago" --no-pager 2>/dev/null \
        | grep -o 'https://[^ |]*trycloudflare.com' | tail -1 || true)
    if [ -n "$HTTPS_URL" ]; then
        break
    fi
    sleep 2
done

IP=$(curl -s ifconfig.me)

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ MuchovhaOS is running!"
echo ""
echo "  HTTP:  http://${IP}"
if [ -n "$HTTPS_URL" ]; then
    echo "  HTTPS: ${HTTPS_URL}"
else
    echo "  HTTPS: (starting up — run: sudo journalctl -u cloudflared | grep trycloudflare)"
fi
echo "══════════════════════════════════════════════════"
echo ""
echo "Useful commands:"
echo "  sudo docker logs -f muchovhaos                          # app logs"
echo "  sudo docker restart muchovhaos                          # restart app"
echo "  sudo journalctl -u cloudflared | grep trycloudflare     # get HTTPS URL"
