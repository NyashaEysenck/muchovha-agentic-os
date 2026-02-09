# ═══════════════════════════════════════════════════════════════════════════
# Stage 1: Build C++ kernel
# ═══════════════════════════════════════════════════════════════════════════
FROM ubuntu:22.04 AS kernel-build

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake make g++ python3-dev pybind11-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY kernel/ kernel/
WORKDIR /build/kernel
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j$(nproc)

# ═══════════════════════════════════════════════════════════════════════════
# Stage 2: Build React frontend
# ═══════════════════════════════════════════════════════════════════════════
FROM node:20-slim AS frontend-build

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ .
RUN npm run build

# ═══════════════════════════════════════════════════════════════════════════
# Stage 3: Production runtime
# ═══════════════════════════════════════════════════════════════════════════
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# System tools (build tools removed — kernel is pre-built in stage 1)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    bash bash-completion \
    curl wget \
    vim nano \
    git \
    net-tools iputils-ping iproute2 dnsutils \
    htop tree ncdu \
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
    strace ltrace \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# Agent user
RUN useradd -m -s /bin/bash agent && \
    echo "agent ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Python dependencies
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# C++ kernel module
COPY --from=kernel-build /build/kernel/build/agent_kernel*.so /usr/lib/python3/dist-packages/

# Application code
COPY app/ app/

# Bundled skills
COPY skills/ /etc/muchovhaos/skills/

# Built frontend
COPY --from=frontend-build /build/dist/ app/static/

# Skill directories
RUN mkdir -p /home/agent/skills && chown agent:agent /home/agent/skills

# Welcome message
RUN echo '#!/bin/bash\necho ""\necho "  MuchovhaOS — Agentic Operating System"\necho "  The AI agent has full access to this environment."\necho "  MCP endpoint: /mcp"\necho ""\n' > /etc/profile.d/welcome.sh && \
    chmod +x /etc/profile.d/welcome.sh

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
