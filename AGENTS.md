# AGENTS.md

- Think extensively before acting. Identify the next incremental step, figure it out, then execute.
- No em dashes anywhere. Rephrase the content. Don't use double hyphens as a workaround.
- When changing behavior, update the corresponding docs in `site/src/content/docs/` and `README.md` in the same change.
- Minimal comments. Don't state the obvious. No docstrings with args/returns.
- If you make changes to the host/orchestrator and its running somewhere, you should probably restart it.

## Writing style (blog, docs, README)

- No em dashes or double hyphens in prose. Rephrase instead.
- Don't define things by negation to sound different. Say what something IS, not what it ISN'T. Unprompted disclaimers and comparisons to alternatives the reader didn't ask about read as arrogant positioning.
  - Bad: "Not a single context window, not a vector database. A set of files with different purposes."
  - Good: "A set of files with different purposes, persistence rules, and audiences."
  - Bad: "This isn't consciousness. It's not sentience. It's not a creature that 'feels bad.'"
  - Good: "What we're looking at is a system that converts external feedback into durable behavioral change."
  - Exception: clarifying within context is fine ("The chat room isn't a failed feature", "The fixes aren't glamorous") because those are making a point about the thing being discussed, not positioning against external alternatives.

## Restarting the orchestrator

1. Find the Node process: `lsof -i :7770 -P` and identify the `node` PID that has `*:7770 (LISTEN)`. The other PIDs are Cursor/browser SSE clients.
2. Send SIGTERM (not SIGKILL): `kill -TERM <pid>`. SIGTERM triggers the cleanup handler gracefully. SIGKILL (`kill -9`) skips cleanup and should be a last resort.
3. Never `lsof -ti :7770 | xargs kill -9`. That kills browser and editor processes too.
4. Wait for the port to free: `lsof -ti :7770` should return nothing.
5. Start: `cd openseed && npx tsx src/host/index.ts`
6. Verify ports match Docker: compare `curl -s localhost:7770/api/creatures` ports against `docker ps --format '{{.Names}}\t{{.Ports}}'`.