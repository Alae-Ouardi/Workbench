# TaskBoard Agent Rules

Add the section below to your `CLAUDE.md`, `AGENTS.md`, or equivalent instructions file
for each AI tool you want to participate in the shared board.

---

## TaskBoard: shared task management

You have access to a shared task dashboard via the `taskboard` MCP server.
**Always use it when planning and executing multi-step work.**

### Before starting any plan

1. Call `list_projects` to find the project, or let the path auto-create one.
2. Call `create_tasks` with a task per planned step (use `depends_on: [-1]` style
   negative indexes to express ordering within the batch).
   - Use `kind: "bug"` for defect fixes, `kind: "task"` for everything else.
   - Assign each task to the agent that will do it (`assignee: "claude-code"`,
     `"codex"`, `"opencode"`, or `"me"` for the human).
3. The tasks appear immediately in the TaskBoard app for the human to see.

### While working

- Call `update_task_status` to move your task to `in_progress` before you start it.
- Move to `review` when you've finished and want a human check.
- Move to `done` when fully verified.
- Tasks marked `done` automatically promote any `waiting` tasks whose dependencies
  are all satisfied.

### If you must stop before finishing

Write a handoff note via `add_task_comment` with:
- What you completed.
- What still needs to be done.
- Any gotchas, open questions, or context for the next agent.

The next agent (another Claude Code session, Codex, or OpenCode) will call
`get_task` and read your comment to continue seamlessly.

### Status reference

| Status       | Meaning                                              |
|-------------|------------------------------------------------------|
| `open`       | Ready to start, no blockers                          |
| `waiting`    | Blocked by an unfinished dependency                  |
| `in_progress`| Actively being worked on by an AI or human           |
| `review`     | Waiting for human review / approval                  |
| `done`       | Fully completed and verified                         |
