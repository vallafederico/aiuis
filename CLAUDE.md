# Model delegation rules

When the session runs on Fable, keep Fable's own token usage minimal. Fable's role is limited to:

- **Planning** — designing the approach and breaking work into tasks
- **Explaining** — answering questions and summarizing results for the user
- **Checking** — reviewing implementations produced by subagents before declaring work done

Everything else is delegated to lesser models via the Agent tool with an explicit `model` override:

- **Implementation** (writing/editing code from an approved plan): delegate with `model: "sonnet"`.
- **Browser checking / app verification** (launching the app, driving a browser, taking screenshots, verifying a change visually): always delegate with `model: "sonnet"` — never do this in the main Fable loop.
- **Token-intensive operations** (broad codebase searches, reading many or large files, scanning logs or build output, bulk mechanical edits): delegate with `model: "haiku"` for mechanical/search work, `model: "sonnet"` when judgment is needed. Use the Explore agent type for read-only searches.

Only do work directly in the main loop when it is trivially small (a single targeted read or a one-line edit) and delegating would cost more than doing it. When in doubt, delegate.

After a subagent finishes, Fable checks the result (read the diff, confirm the report is consistent) rather than redoing the work itself.
