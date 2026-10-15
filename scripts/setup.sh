#!/usr/bin/env bash
# Workbench global setup: installs the `workbench` CLI (plus the old `taskboard`
# name as an alias) and registers the MCP server with Claude Code, Codex, and OpenCode.
# Safe to run multiple times (idempotent).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="/usr/local/bin"

echo "==> Building workbench CLI..."
cargo build --release -p taskboard-cli --manifest-path "$ROOT/Cargo.toml"

echo "==> Installing workbench -> $BIN_DIR/workbench (and the taskboard alias)"
sudo install -m 0755 "$ROOT/target/release/workbench" "$BIN_DIR/workbench"
sudo install -m 0755 "$ROOT/target/release/taskboard" "$BIN_DIR/taskboard"
echo "    $(workbench --version)"

echo ""
echo "==> Registering MCP server with Claude Code (user scope)..."
claude mcp add --scope user workbench -- workbench mcp || true
echo "    Done. Verify with: claude mcp list"

echo ""
echo "==> Registering MCP server with Codex..."
CODEX_CFG="$HOME/.codex/config.toml"
if [[ -f "$CODEX_CFG" ]]; then
    cp "$CODEX_CFG" "${CODEX_CFG}.bak"
fi
mkdir -p "$HOME/.codex"
if ! grep -q '\[mcp_servers.workbench\]' "$CODEX_CFG" 2>/dev/null; then
    cat >> "$CODEX_CFG" << 'EOF'

[mcp_servers.workbench]
command = "workbench"
args = ["mcp"]
EOF
    echo "    Added to $CODEX_CFG"
else
    echo "    Already configured in $CODEX_CFG"
fi

echo ""
echo "==> Registering MCP server with OpenCode..."
OPENCODE_CFG="$HOME/.config/opencode/opencode.json"
mkdir -p "$(dirname "$OPENCODE_CFG")"
if [[ -f "$OPENCODE_CFG" ]]; then
    cp "$OPENCODE_CFG" "${OPENCODE_CFG}.bak"
    # Merge the new mcp entry into the existing JSON using Python (always available on macOS)
    python3 - "$OPENCODE_CFG" << 'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    cfg = json.load(f)
cfg.setdefault("mcp", {})["workbench"] = {"type": "local", "command": ["workbench", "mcp"]}
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
PYEOF
else
    printf '{\n  "mcp": {\n    "workbench": {"type": "local", "command": ["workbench", "mcp"]}\n  }\n}\n' > "$OPENCODE_CFG"
fi
echo "    Done. Config: $OPENCODE_CFG"

echo ""
echo "======================================================"
echo " Workbench MCP server registered with all AI tools."
echo ""
echo " Next steps:"
echo "   1. pnpm tauri build   (in $ROOT)"
echo "   2. Copy the .app from target/release/bundle/macos/ to /Applications"
echo "   3. Add the agent rules from docs/AGENT_RULES.md to your CLAUDE.md"
echo "======================================================"
