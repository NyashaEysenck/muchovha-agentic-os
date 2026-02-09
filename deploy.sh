#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# MuchovhaOS — One-shot Azure B1s deployment script
# Run this ON the VM after cloning your repo
# Usage: chmod +x deploy.sh && ./deploy.sh
# ═══════════════════════════════════════════════════════════════
set -e

echo "══════════════════════════════════════"
echo "  MuchovhaOS Deployment"
echo "══════════════════════════════════════"

# ── 1. Swap (critical for 1 GB RAM) ──
if [ ! -f /swapfile ]; then
    echo "[1/4] Creating 2 GB swap..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
    echo "  ✓ Swap enabled"
else
    echo "[1/4] Swap already exists, skipping"
fi

# ── 2. Install Docker ──
if ! command -v docker &> /dev/null; then
    echo "[2/4] Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    echo "  ✓ Docker installed"
else
    echo "[2/4] Docker already installed, skipping"
fi

# ── 3. Check for API key ──
if [ ! -f .env ]; then
    echo ""
    read -p "Enter your GEMINI_API_KEY: " api_key
    echo "GEMINI_API_KEY=$api_key" > .env
    echo "  ✓ .env created"
else
    echo "[3/4] .env found"
fi

# ── 4. Build and run ──
echo "[4/4] Building and starting MuchovhaOS (this takes ~5-10 min on B1s)..."
sudo docker build -t muchovhaos .
sudo docker run -d \
    --name muchovhaos \
    --restart unless-stopped \
    --env-file .env \
    --privileged \
    -p 80:8000 \
    muchovhaos

echo ""
echo "══════════════════════════════════════"
echo "  ✓ MuchovhaOS is running!"
echo "  Open: http://$(curl -s ifconfig.me)"
echo "══════════════════════════════════════"
echo ""
echo "Useful commands:"
echo "  sudo docker logs -f muchovhaos   # view logs"
echo "  sudo docker restart muchovhaos   # restart"
echo "  sudo docker stop muchovhaos      # stop"
