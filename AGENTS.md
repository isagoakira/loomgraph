# Agent Visual Canvas implementation

Use the fixed V1 plan at `docs/plans/excalidraw_plugin_v1_implementation_plan.md` and this project's `CONTEXT.md`. This is a standalone plugin; do not change AutoResearch's frontend, backend, root contracts, or other unrelated edits.

The root agent owns configuration, shared `src/contracts`, integration, and acceptance. Workers own only their assigned modules. You are not alone in the codebase: preserve and accommodate others' edits; do not revert them. Request shared contract changes from the root agent.

Use released public Excalidraw APIs. Store meaningful changes transactionally, preserve stable identities and the user's viewport, and keep temporary presentation separate. Do not claim delivery or real execution from queue insertion or mock results. Use actual local data for the UI.

Record actual checks and limitations. Keep logs off MCP stdout. Do not install or edit the user's MCP configuration, open remote services, or write long-term memory as part of a worker subtask.
