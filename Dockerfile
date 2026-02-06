# ═══════════════════════════════════════════════════════════════════════════
# Stage 1: Build React frontend
# ═══════════════════════════════════════════════════════════════════════════
FROM node:20-slim AS frontend-build

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ .
RUN npm run build

# ═══════════════════════════════════════════════════════════════════════════
# Stage 2: Production runtime (Linux learning environment)
# ═══════════════════════════════════════════════════════════════════════════
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ── Install Linux learning tools ────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    bash bash-completion \
    curl wget \
    vim nano \
    git \
    gcc g++ make \
    net-tools iputils-ping iproute2 dnsutils \
    htop tree ncdu \
    man-db manpages manpages-dev \
    sudo \
    less file \
    zip unzip tar gzip bzip2 \
    grep sed gawk \
    openssh-client \
    procps \
    lsof \
    cron \
    jq \
    tmux \
    ca-certificates \
    locales \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# ── Create learner user ────────────────────────────────────────────────────
RUN useradd -m -s /bin/bash learner && \
    echo "learner ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# ── Install Python dependencies ────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# ── Copy application ───────────────────────────────────────────────────────
COPY app/ app/

# ── Copy built frontend from stage 1 ──────────────────────────────────────
COPY --from=frontend-build /build/dist/ app/static/

# ── Welcome message for learner ────────────────────────────────────────────
RUN echo '#!/bin/bash\necho ""\necho "  🐧 Welcome to LinuxMentor!"\necho "  Type any Linux command to get started."\necho "  Press Ctrl+K for the command palette."\necho "  The AI assistant on the right can help you."\necho ""\n' > /etc/profile.d/welcome.sh && \
    chmod +x /etc/profile.d/welcome.sh

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
