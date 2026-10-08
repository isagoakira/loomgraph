# Real-Time Selection Assistant in the Canvas

Select one or more objects and click “Let Agent Handle It” to open a movable, resizable, collapsible conversation window. The window discusses the targets selected when it was opened by default; after changing the selection, you can explicitly switch targets, with drafts retained separately. The context inspector shows editable content, read-only neighbors, source revisions, and omitted items.

“Q&A” only explains content. “Propose Changes” generates a candidate and previews it on the original canvas; follow-up questions can revise the same candidate. Apply it after reviewing the before-and-after differences, or discard it. Applying creates a project revision and a receipt of actual changes; chatting, zooming, and temporary previews do not create content versions. Content that has been temporarily removed can still be discussed and a restoration requested.

The current scope of changes covers existing selected objects, representations, relationship descriptions, and text/free elements. Object body content is shared across multiple representations; representation placement affects only representations explicitly selected. Text anchors help locate content but do not currently provide paragraph-level write protection. Very large content that has not been read in full can be discussed in Q&A, but rewriting it will be rejected. Creating new graphs, adding arbitrary new objects, and executing business operations are outside this assistant’s first-release scope of actions.

## Local Backend

After Codex CLI or Claude Code CLI is installed, the backend runs it on demand and cleans up the temporary working directory afterward. It reuses the software’s own login, model, and provider routing without rewriting the host configuration. “Available” in the selector means the software or configuration was found; actual connectivity is confirmed by each request’s result. If a CLI fails, it does not silently switch to another model.

Codex uses a temporary configuration directory that retains model routing and authentication, removes the host MCP configuration, and disables tools, plugins, and hooks. Claude is invoked with no tools, a strictly empty MCP configuration, and no session persistence. Canvas changes can only be made through controlled candidate validation and transactional commits.

If a CLI is not needed, place `agent-config.json` in the project data directory, or use `AVC_AGENT_CONFIG` to point to a local file. OpenAI-compatible and Anthropic protocols are supported. Replace the address and model in the example with your actual configuration:

```json
{
  "type": "openai-compatible",
  "baseUrl": "https://your-provider.example/v1",
  "model": "your-model",
  "apiKeyEnv": "AVC_MODEL_API_KEY"
}
```

Only the local service reads the key from an environment variable; the page never receives it. This configuration does not automatically read the database of arbitrary desktop software. The CLI path is already adapted to the host configuration; the API path requires explicit configuration. `AVC_AGENT_HOST=claude` can be used to prefer Claude CLI; Codex CLI is preferred by default.

## Interface Modes

The Chinese “View” tool on the canvas provides grid alignment, object snapping, and focus mode. Grid alignment and object snapping are mutually exclusive and apply to dragging and resizing custom cards/text. Focus mode hides surrounding tools and sidebars; exiting restores existing preferences. The native SDK right-click menu remains available and has not been forcibly rewritten through private APIs.

## Runtime Boundaries

Each session processes one turn at a time, with at most two turns running concurrently on the local machine. A selection can contain at most 40 explicit targets. Each turn’s prompt has a total budget of 70KB, and raw writable source material has a budget of 24KB; overages are shown explicitly in the inspector. Each model call has a timeout and an output limit, and the actual call can be stopped. After a refresh, reopening the same selection can recover its saved session; unfinished replies after a service restart are marked as interrupted, and old requests are not restarted automatically.

The current context consists primarily of structured text and object information. The model does not receive a canvas screenshot; visual quality of the layout still requires acceptance through actual rendering and cannot be inferred as verified solely from the model’s reply.
