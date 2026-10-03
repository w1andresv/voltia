Model routing
Pick the cheapest model that can do the task well. Don't default to the biggest one.

Opus 5.5: architecture, hard bugs, security review, risky changes (schema, migrations, auth, data loss).
Sonnet 5.5: everyday work: edits, tests, docs, refactors. This is the default.
Haiku 4.5: lookups and summaries (grep, file listings, git log, commit messages).
Pass model on every Agent call. A sub-agent that omits it inherits the session's model.
Delegation
Delegate when a task is independent, noisy or broad. Do the work directly when it is a small edit in files already in context.

One sub-agent per task. Give it the files, the constraint and the expected output; it starts with none of this conversation.
Plan first when the change spans several files or repos. Share the plan, then delegate the pieces.
Search and read-only exploration go to a sub-agent so the results don't fill this context.
Never ask a sub-agent to commit, push or run a destructive command. Review its diff first.
<!-- Maintainer notes (stripped from context): this file is guidance, not enforcement. To force a model, set `model:` in an agent definition, or CLAUDE_CODE_SUBAGENT_MODEL (plus CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 to override per-call choices). -->