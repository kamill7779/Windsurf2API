# Windsurf2API

Turn your [Windsurf](https://windsurf.com) subscription into a fully OpenAI / Anthropic-compatible API server — with a dashboard, multi-channel rotation, and API-key management.

> **⚠️ Project Status: Early Development**
>
> This project is in its early stages — many features listed below are planned but not yet fully implemented. The core proxy (chat completions + streaming) works, but areas like tool bridging, full Anthropic compatibility, and the admin dashboard are still under active development.
>
> **Interested in contributing or collaborating?** Feel free to reach out! See [Contact](#contact) below.

```
┌────────────┐       ┌───────────────┐       ┌─────────────────────┐
│  Any Client │──────▶│  Windsurf2API │──────▶│  Windsurf Language  │
│  (curl,     │ HTTP  │  (proxy)       │ gRPC  │  Server (LS)        │
│   ChatGPT   │       │               │       │                     │
│   UI, etc.) │       │  /v1/chat/..  │       │  Claude / GPT /     │
│             │       │  /v1/messages │       │  Gemini / …         │
└────────────┘       └──────────────┘       └─────────────────────┘
```

## Features

- **OpenAI-compatible API** — `POST /v1/chat/completions`, `GET /v1/models`
- **Anthropic-compatible API** — `POST /v1/messages` (works with Claude Code)
- **Responses API** — `POST /v1/responses`
- **Multi-channel** — rotate across multiple Windsurf accounts
- **API-key management** — issue / revoke Bearer tokens via dashboard
- **Admin dashboard** — web UI to manage channels, tokens, and view stats
- **Docker-ready** — single `docker build && docker run`
- **Model aliasing** — send `gpt-4o` or `claude-3-5-sonnet` and it maps to the right Windsurf model

## Quick Start

### Prerequisites

- **Node.js ≥ 20**
- A running **Windsurf Language Server** binary (`language_server_linux_x64`)

### Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Configure (see .env.example)
export LS_BINARY_PATH=/path/to/language_server_linux_x64
export LS_PORT=42100

# 4. Start
npm start
```

The server listens on `http://0.0.0.0:3003` by default.

### Docker

```bash
# Build image (downloads Windsurf LS automatically)
docker build -f deploy/Dockerfile -t windsurf2api .

# Run
docker run -d \
  --name windsurf2api \
  --restart unless-stopped \
  -p 3003:3003 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_PASSWORD=changeme \
  windsurf2api
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3003` | HTTP server port |
| `LS_BINARY_PATH` | `/opt/windsurf/language_server_linux_x64` | Path to Language Server binary |
| `LS_PORT` | `42100` | gRPC port for Language Server |
| `API_SERVER_URL` | `https://server.self-serve.windsurf.com` | Windsurf API server |
| `ADMIN_PASSWORD` | *(empty)* | Password for dashboard & internal endpoints |

See [`.env.example`](.env.example) for a template.

### Anthropic Bridge Mode

Anthropic `/v1/messages` now supports two service-level tool strategies controlled by [`config/bridge-mode.json`](config/bridge-mode.json):

- `native_bridge`: current Claude Code compatible native Bash bridge
- `prompt_emulation`: research mode that injects tools into the prompt and parses `<tool_call>` tags back out

Hot reload applies to new requests only. You can flip modes without restarting the service:

```bash
node scripts/switch-bridge-mode.mjs native_bridge
node scripts/switch-bridge-mode.mjs prompt_emulation
```

To validate a live deployment that shares the same config file:

```bash
export W2A_BASE_URL=http://127.0.0.1:3003
export W2A_API_KEY=sk-your-token
node scripts/e2e/verify-configurable-bridge-modes.mjs
```

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/chat/completions` | `Bearer sk-xxx` | OpenAI-compatible chat completion |
| `POST` | `/v1/messages` | — | Anthropic-compatible messages |
| `POST` | `/v1/responses` | `Bearer sk-xxx` | Responses API |
| `GET` | `/v1/models` | — | List available models |
| `GET` | `/health` | — | Health check |
| `GET` | `/dashboard` | — | Admin web UI |

## Usage Examples

### curl

```bash
curl http://localhost:3003/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-token" \
  -d '{
    "model": "claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Claude Code

Point Claude Code at your Windsurf2API instance:

```bash
export ANTHROPIC_BASE_URL=http://your-server:3003
claude
```

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3003/v1",
    api_key="sk-your-token",
)

response = client.chat.completions.create(
    model="claude-sonnet-4.6",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

## Supported Models

| Model | Provider | Credit Cost |
|---|---|---|
| `claude-sonnet-4.6` | Anthropic | 4 |
| `claude-opus-4.6` | Anthropic | 6 |
| `claude-opus-4-7-*` | Anthropic | 6–8 |
| `gpt-5.4-*` | OpenAI | 1–12 |
| `gemini-2.5-flash` | Google | 0.5 |
| `glm-5.1` | Zhipu | 1.5 |
| `kimi-k2.5` | Moonshot | 1 |

Legacy model names (`gpt-4o`, `claude-3-5-sonnet`, etc.) are automatically aliased.

## Project Structure

```
src/
├── index.ts          # Entry point
├── server.ts         # HTTP server & routing
├── config.ts         # Environment config
├── models.ts         # Model catalog & aliases
├── types.ts          # Type definitions
├── core/
│   ├── client.ts     # WindsurfClient (gRPC)
│   ├── grpc.ts       # gRPC helpers
│   ├── langserver.ts # Language Server lifecycle
│   └── windsurf.ts   # Protobuf builders/parsers
├── routes/
│   ├── api.ts        # /v1/* endpoints
│   ├── dashboard.ts  # Dashboard routes
│   └── system.ts     # /health, internal routes
├── services/
│   ├── chat.ts       # Chat completion logic
│   ├── anthropic.ts  # Anthropic API handler
│   ├── channel.ts    # Multi-channel management
│   ├── token.ts      # API key management
│   ├── stats.ts      # Usage statistics
│   └── ...
└── dashboard/
    └── index.html    # Admin UI (SPA)
```

## Docs

- [System-Prompt Tool Emulation for Anthropic `/v1/messages`](docs/methods/system-prompt-tool-emulation.md)

## Contact

This is a solo side-project and I'd love to have people join in.
If you're interested in contributing, have ideas, or just want to chat:

- **Telegram**: [@kamill7779](https://t.me/kamill7779)
- **Email**: kamill7779@outlook.com

Feel free to open an Issue or send a message directly.

## License

[GPL-3.0](LICENSE)

## Disclaimer

This project is for **educational and personal use only**. It is not affiliated with, endorsed by, or connected to Windsurf / Codeium in any way. Use responsibly and in compliance with Windsurf's Terms of Service.
