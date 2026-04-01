# msco-openclaw

Microsoft Copilot provider plugin for OpenClaw.

## Install

Install from a local path:

```bash
openclaw plugins install /absolute/path/to/msco-openclaw
```

Enable the provider plugin:

```bash
openclaw plugins enable msco-openclaw
```

Restart OpenClaw after enabling.

## Authenticate

Run token auth:

```bash
openclaw models auth login --provider microsoft-copilot --set-default
```

When prompted, paste your Microsoft Copilot access token.

## Configuration

Environment variables:

```dotenv
MICROSOFT_COPILOT_ACCESS_TOKEN=
MICROSOFT_COPILOT_COOKIE=
MICROSOFT_COPILOT_CONVERSATION_ID=
MICROSOFT_COPILOT_CLIENT_SESSION_ID=
MICROSOFT_COPILOT_MODE=reasoning
MICROSOFT_COPILOT_CHANNEL=edge
MICROSOFT_COPILOT_API_VERSION=2
MICROSOFT_COPILOT_DEBUG=0
MICROSOFT_COPILOT_TRACE=0
MICROSOFT_COPILOT_TRACE_FILE=logs/copilot-session.ndjson
```

Legacy `COPILOT_*` names are accepted.

## Model

This plugin currently exposes one model:

- `microsoft-copilot/copilot`

Thinking mapping:

- `off`, `minimal`, `low` -> `smart`
- `medium`, `high`, `xhigh` -> `reasoning`

## Limitations (v1)

- Single-model provider: only `microsoft-copilot/copilot` is supported.
- Token-based auth only (paste token via `openclaw models auth login`).
- Usage/quota endpoint integration is not included in v1.

## Troubleshooting

- **`Microsoft Copilot token missing`**
  - Re-run:
    ```bash
    openclaw models auth login --provider microsoft-copilot --set-default
    ```
  - Confirm `MICROSOFT_COPILOT_ACCESS_TOKEN` is set (or configured in OpenClaw auth storage).

- **Unknown model error**
  - Use exactly: `microsoft-copilot/copilot`.
  - This provider is intentionally single-model in v1.

- **Plugin not available after install**
  - Ensure plugin is enabled:
    ```bash
    openclaw plugins enable msco-openclaw
    ```
  - Restart OpenClaw after enabling.

- **No usage/quota numbers shown**
  - Expected in v1. Usage endpoint wiring is not implemented yet.

- **No output and no visible Copilot web conversation**
  - Enable tracing:
    ```bash
    export MICROSOFT_COPILOT_TRACE=1
    export MICROSOFT_COPILOT_TRACE_FILE=~/.openclaw/logs/msco-openclaw.ndjson
    ```
  - Restart OpenClaw and retry once, then inspect:
    ```bash
    tail -n 120 ~/.openclaw/logs/msco-openclaw.ndjson
    ```
  - Look for these events:
    - `request.start`
    - `conversation.create.start` / `conversation.create.done`
    - `socket.inbound.event`
    - `request.completed` or `request.failed`
