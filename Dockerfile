# Stage 1: Extract language_server_linux_x64 from Windsurf
FROM debian:bookworm-slim AS extractor
RUN apt-get update && apt-get install -y --no-install-recommends wget gpg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN wget -qO- "https://windsurf-stable.codeiumdata.com/wVxQEIWkwPUEAGf3/windsurf.gpg" \
    | gpg --dearmor > /usr/share/keyrings/windsurf-stable.gpg
RUN echo "deb [arch=amd64 signed-by=/usr/share/keyrings/windsurf-stable.gpg] \
    https://windsurf-stable.codeiumdata.com/wVxQEIWkwPUEAGf3/apt stable main" \
    > /etc/apt/sources.list.d/windsurf.list
RUN apt-get update && apt-get install -y --no-install-recommends windsurf \
    && rm -rf /var/lib/apt/lists/*
RUN find /usr/share/windsurf -name "language_server_linux_x64" -type f \
    -exec cp {} /tmp/language_server_linux_x64 \; && \
    chmod +x /tmp/language_server_linux_x64

# Stage 2: Runtime
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=extractor /tmp/language_server_linux_x64 /opt/windsurf/language_server_linux_x64
RUN chmod +x /opt/windsurf/language_server_linux_x64
COPY dist/ ./dist/
RUN mkdir -p /opt/windsurf/data/default/db /tmp/windsurf-workspace
EXPOSE 3003
ENV LS_BINARY_PATH=/opt/windsurf/language_server_linux_x64
ENV LS_PORT=42100
ENV API_SERVER_URL=https://server.self-serve.windsurf.com
CMD ["node", "dist/index.js"]
