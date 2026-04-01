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
  - Use daemon-safe env (recommended):
    ```bash
    mkdir -p ~/.openclaw/logs
    cat > ~/.openclaw/.env <<'EOF'
    MICROSOFT_COPILOT_TRACE=1
    MICROSOFT_COPILOT_TRACE_FILE=$HOME/.openclaw/logs/msco-openclaw.ndjson
    EOF
    ```
  - Restart gateway and retry once:
    ```bash
    openclaw gateway restart
    ```
  - Inspect trace (latest entries):
    ```bash
    tail -n 120 ~/.openclaw/logs/msco-openclaw.ndjson
    ```
  - Quick verification filters:
    ```bash
    grep -E "plugin.debug.enabled|plugin.stream.invoked|request.start|request.completed|request.failed" ~/.openclaw/logs/msco-openclaw.ndjson | tail -n 40
    ```
  - Look for these events:
    - `plugin.debug.enabled` (confirms daemon loaded env + plugin startup)
    - `plugin.stream.invoked` (confirms your actual request executed through this plugin)
    - `request.start`
    - `conversation.create.start` / `conversation.create.done`
    - `socket.inbound.event`
    - `request.completed` or `request.failed`
  - TUI-visible validation: when debug is enabled and request fails, the trace now includes explicit reasons such as
    `No Copilot response events received before timeout`, which should align with the user-facing error path.
