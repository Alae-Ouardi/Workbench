# TaskBoard

A shared kanban board for humans and AI coding agents. TaskBoard runs as a macOS desktop app, a CLI, and an MCP server — all backed by the same local SQLite database so every tool sees the same live state.

![TaskBoard main board](docs/screenshot-board.png)

## Features

- **Kanban board** — columns: `open`, `waiting`, `in_progress`, `review`, `done`
- **Context banner** — shows the AI's original brief, the approved plan, and the last session ID with a one-click copy (for `claude --resume`)
- **Handoff system** — AI agents record where they stopped; the next agent reads it via `get_briefing` and resumes at the right task
- **macOS menubar icon** — compact popover to view active tasks, quick-add, inline edit status/priority/description, and delete tasks without opening the full window
- **Create projects in-app** — folder picker + title + AI brief; the description is stored as `original_request` and read by AI tools immediately
- **Embedded terminal** — shell panel scoped to the selected project's directory
- **MCP server** — AI tools for planning, task tracking, and handoff (works with Claude Code, Codex, OpenCode)
- **CLI** — `taskboard` binary for scripting and CI
- **Live sync** — all windows and tools react to changes instantly via Tauri events

## Architecture

```
taskboard/
├── crates/
│   ├── taskboard-core/     # Rust lib: SQLite schema, all DB logic
│   └── taskboard-cli/      # Binary: CLI subcommands + MCP server (stdio)
├── src-tauri/              # Tauri 2 app shell (Rust)
├── src/                    # React + TypeScript frontend (Vite)
│   └── components/
│       ├── Board.tsx        # Kanban columns
│       ├── ContextBanner.tsx
│       ├── TrayPopover.tsx  # Menubar popover window
│       ├── Sidebar.tsx
│       ├── TaskDrawer.tsx
│       ├── NewProjectModal.tsx
│       └── Terminal.tsx
└── ~/.taskboard/
    └── taskboard.db        # Shared SQLite DB (WAL mode)
```

The CLI binary and the desktop app share the same database at `~/.taskboard/taskboard.db`. The `taskboard mcp` subcommand runs the MCP server over stdio, exposing tools to AI coding assistants.

## Requirements

- **macOS** (Tauri 2 with `tray-icon` feature)
- **Rust** — [rustup.rs](https://rustup.rs)
- **Node.js ≥ 18** + **pnpm**

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Development mode

```bash
pnpm tauri dev
```

### 3. Production build

```bash
pnpm tauri build
```

Outputs:
- `target/release/bundle/macos/TaskBoard.app`
- `target/release/bundle/dmg/TaskBoard_0.1.0_aarch64.dmg`

### 4. Install the CLI

```bash
sudo cp target/release/taskboard /usr/local/bin/taskboard
```

### 5. Connect to Claude Code (MCP)

Add to your `~/.claude/mcp_servers.json` (or project-level `.claude/mcp_servers.json`):

```json
{
  "mcpServers": {
    "taskboard": {
      "command": "taskboard",
      "args": ["mcp"]
    }
  }
}
```

## CLI Usage

```bash
# List projects
taskboard projects

# Add a task
taskboard add --project /path/to/project "Implement login flow"

# Move a task
taskboard move 12 in_progress

# Show the AI briefing for a project
taskboard briefing --project /path/to/project

# Record a handoff (AI saves where it stopped)
taskboard handoff --project /path/to/project \
  --session "your-session-id" \
  --task 12 \
  --note "Finished auth middleware. Next: write tests."

# Set project context (original request + plan)
taskboard context --project /path/to/project \
  --request "Build a login system with OAuth" \
  --plan "Phase 1: schema; Phase 2: endpoints; Phase 3: frontend"
```

## MCP Tools (for AI agents)

| Tool | Description |
|------|-------------|
| `get_briefing` | Returns the original request, approved plan, handoff state, and the task to resume |
| `create_tasks` | Create a list of tasks with dependencies, priorities, and assignees |
| `update_task_status` | Move a task to `open`, `in_progress`, `review`, or `done` |
| `save_handoff` | Record where the AI stopped (session ID, task, note) |
| `set_project_context` | Store the original request and plan summary |
| `list_tasks` | List tasks filtered by project/status/assignee |
| `get_task` | Full task detail including comments and activity |
| `update_task` | Edit title, description, priority, assignee |
| `delete_task` | Delete a task |
| `add_task_comment` | Add a handoff note or comment to a task |
| `set_task_dependencies` | Wire up task dependencies |
| `list_projects` | List all projects with task counts |
| `delete_project` | Delete a project and all its tasks |

## AI Workflow

The intended flow for AI coding agents:

1. **Start of session** — call `get_briefing(project_path)` to read the north-star context and resume at the right task
2. **Before coding** — call `update_task_status(id, "in_progress")`
3. **After coding** — call `update_task_status(id, "done")`
4. **End of session / before stopping** — call `save_handoff(...)` with the session ID so the next agent can resume

The desktop app and CLI show everything the AI writes in real time.

## Task Statuses

| Status | Meaning |
|--------|---------|
| `open` | Ready to start |
| `waiting` | Blocked by an unfinished dependency |
| `in_progress` | Being worked on |
| `review` | Awaiting human review |
| `done` | Fully completed |

Marking a task `done` automatically promotes any `waiting` tasks whose dependencies are now satisfied.

## Database

The SQLite database lives at `~/.taskboard/taskboard.db` and is shared by the app, CLI, and MCP server. It uses WAL mode for concurrent access. Foreign key cascades ensure project deletion removes all associated tasks, comments, events, and dependencies.

Override the path with the `TASKBOARD_DB` environment variable.

## Tech Stack

- **Rust** — core library, CLI, MCP server, Tauri backend
- **Tauri 2** — macOS desktop app with multi-window support (main board + menubar popover)
- **React 18 + TypeScript** — frontend
- **Tailwind CSS** — styling
- **Vite** — frontend build
- **SQLite (rusqlite)** — local database
- **clap** — CLI argument parsing

## License

MIT
