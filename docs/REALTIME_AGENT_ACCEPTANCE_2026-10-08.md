# Real-Time Agent Acceptance — 2026-10-08

## Decision

This round is a **restricted first-stage acceptance** of the in-canvas selection Agent. It is an accepted increment with explicit boundaries; it is **not a claim that all V1 gates are complete**.

The accepted interaction is:

> freeze the selected scope → read one-hop neighbours as context → answer or prepare a structured candidate → refine the same candidate → explicitly Apply or Discard → retain a receipt-backed undo path.

The panel is movable, resizable, and collapsible. Grid alignment, object snapping, and focus mode are present as separate viewing/editing controls. The first action set edits existing selected content only. It does not create arbitrary objects or graphs and does not execute business operations.

## Evidence identity and version boundary

The primary project remained untouched by this isolated acceptance. [`main-before.json`](evidence/realtime-agent-20261008/main-before.json) and [`main-after.json`](evidence/realtime-agent-20261008/main-after.json) match: PID `61804`, build `agent-harness-20261007-r29.3`, revision `R200`, project/work-copy identities, and snapshot SHA-256 `c6e1e9e4cb422faebf40ec69a8fafd17ea741e14c4f9d0920b5423625c1980db`. r30 is installed and the isolated demo runs the installed r30 build. The current primary MCP host has not reloaded it; that requires a later host restart.

The interaction evidence uses the isolated demo identified by [`demo-identity.json`](evidence/realtime-agent-20261008/demo-identity.json): graph `realtime-agent-demo`, revision `R1` at baseline, and an independent project/work copy. The phase files are the source of the revision claims below.

| Phase | Recorded result | Evidence |
|---|---|---|
| Baseline | Target `scope` is titled `选区冻结`; geometry is `(80, 140, 360, 300)`; the unknown `demoPreserve` extension and the untouched digest are recorded. | [`baseline-state.json`](evidence/realtime-agent-20261008/baseline-state.json) |
| Candidate preview | The selected scope remains at `R1`; no project write is recorded. | [`preview-state.json`](evidence/realtime-agent-20261008/preview-state.json) |
| Continuous refinement | A follow-up proposal is still based on the same frozen target at `R1`; no project write is recorded. | [`refined-preview-state.json`](evidence/realtime-agent-20261008/refined-preview-state.json), [`refined-preview.png`](evidence/realtime-agent-20261008/refined-preview.png) |
| Apply | The selected content changes to `锁定范围` at `R2`; geometry, the unknown extension, and the untouched digest remain unchanged. The browser run produced the real Apply receipt. | [`applied-state.json`](evidence/realtime-agent-20261008/applied-state.json), [`applied.png`](evidence/realtime-agent-20261008/applied.png) |
| Undo | The original title `选区冻结` is restored at `R3`; the isolated run used the receipt-backed undo path. | [`undo-state.json`](evidence/realtime-agent-20261008/undo-state.json) |

The screenshots are rendering evidence for the local page. They are not evidence that a screenshot was supplied to the model.

## Accepted gates

### Selection and candidate workflow — accepted for the tested local path

- Q&A leaves the content revision unchanged and exposes one-hop neighbours as read-only context.
- A structured candidate previews in place without advancing the project revision.
- A follow-up request refines the same candidate rather than silently starting from a different selection.
- Apply writes once and advances the isolated demo from `R1` to `R2`; repeated application is idempotent.
- Discard removes a pending candidate without writing content. A candidate refined back to its baseline is treated as a no-op.
- Undo returns the isolated demo from `R2` to `R3`, restoring the original content while preserving revision history.
- Candidate operations are bounded to explicit selected identities. Neighbours, incident relations, other graphs, fabricated runs, unknown operation kinds, fixed geometry, and mismatched native identities are rejected by the controller contract.

The browser run also verified the movable/resizable dialogue, the selected-target context display, real-time Q&A, continued candidate modification, and the Apply/Discard controls. The panel drag moved its left edge from `x=992` to `x=912`; resize ended at `400×611` from `430×631`. The explicit selection-switch run changed from the frozen `选区冻结` scope to a candidate-preview scope with an empty new draft, then explicitly switched back and restored the original unsent draft; the test draft was cleared afterwards. See [`scope-and-panel.json`](evidence/realtime-agent-20261008/scope-and-panel.json). The accompanying images show the Q&A, refined preview, and applied revision.

### Local provider path — accepted separately from the controller tests

The installed local CLI smoke invoked the actual commands and returned structured answers:

- [`codex-cli-smoke.json`](evidence/realtime-agent-20261008/codex-cli-smoke.json) records a successful Codex CLI run and a parsed answer with an empty operation list.
- [`claude-cli-smoke.json`](evidence/realtime-agent-20261008/claude-cli-smoke.json) records a successful Claude CLI run and a parsed answer with an empty operation list.

The real browser run selected a CLI backend for Q&A and candidate refinement. Claude stop was also checked in the browser: stopping the active request reported interruption and did not turn it into a business run. These observations establish the local CLI/UI path that was tested; they do not establish Windows host acceptance or a real remote/API endpoint.

### Controls — accepted on the installed local page

The installed-page run recorded [`final-modes.json`](evidence/realtime-agent-20261008/final-modes.json): grid alignment enables grid and disables object snapping; object snapping reverses those states; focus mode changes the top-toolbar height from 236 to 0 and its visible exit restores 236. The mode toolbar is placed below the interface-hide controls. [`final-ui.png`](evidence/realtime-agent-20261008/final-ui.png) records the installed page. [`modes-debug.png`](evidence/realtime-agent-20261008/modes-debug.png) is a historical occlusion capture, not the final result. Card drag/resize snapping has six targeted unit tests; this round does not claim a browser drag acceptance of every snapping variant. All integration uses public SDK APIs.

The latest-selection switch is outside the folded context inspector. A final browser check found it visible while the inspector was collapsed. The message and candidate-diff areas scroll independently; Apply and Discard remain outside the folded diff.

The root verification for this round reports 55 test files / 437 tests, TypeScript type checking, and the production build passing. Relevant source tests include `agent-chat.test.ts`, `agent-providers.test.ts`, `agent-request-drafts.test.ts`, `agent-request-transport.test.ts`, `content-snapping.test.ts`, and `workspace-controls.test.ts`.

## Evidence layers and their limits

The same words “Agent works” refer to different evidence layers. They must remain separate:

| Layer | What it establishes | What it does not establish |
|---|---|---|
| Fake control-layer provider in `agent-chat.test.ts` | Scope freezing, read-only neighbours, candidate validation, revision protection, no-op filtering, lineage, idempotent Apply, cancellation, and no fabricated business run. | It never runs a model or a real CLI. Its replies are fixture data. |
| Provider adapter tests in `agent-providers.test.ts` | Command construction, disabled MCP/tool isolation, Codex/Claude event parsing, bounded output, abort cleanup, and API response parsing using fakes. | They do not prove a real API endpoint or a model’s answer quality. |
| Actual local CLI smoke | The local Codex and Claude executables started, returned, and were parsed under the configured isolation boundary. | It does not prove the browser flow, Windows, a remote host, or an API provider. |
| Actual browser acceptance | The page rendered the scoped dialogue and candidate lifecycle; the tested CLI backend returned the observed answers and the project moved only through the recorded revisions. | It does not provide model visual input. Layout screenshots are page evidence, not model context. |

The API path has only unit coverage in this round. A configured model service, Windows/Claude host round trip, and cross-platform runtime acceptance remain unverified.

## Deployment and retained demo

The explicit selection-switch field is accepted by [`scope-and-panel.json`](evidence/realtime-agent-20261008/scope-and-panel.json): it records an explicit switch to the candidate-preview scope, an empty new draft, an explicit switch back to `选区冻结`, and restoration of the original unsent draft.

- **Installation passed:** [`installation.json`](evidence/realtime-agent-20261008/installation.json) records `0.1.0-local-20261008-r30`, build `realtime-agent-20261008-r30`, 951 verified manifest files, complete archive-entry checks, and verified SHA-256 sidecar. The release archive SHA-256 is `05a892080eb73525baea8751aecca1ba17e3434c43e956ccd7f37236dd877bbf`. The version pointer switched atomically and the old version/skill backup remains available. No primary project data or host configuration was rewritten.
- **Installed stdio passed:** [`installed-r30-smoke-result.json`](evidence/realtime-agent-20261008/installed-r30-smoke-result.json) records an actual isolated MCP handshake, open/read, bounded recipe, read-only validation, one content apply, transport closure, child exit, and temporary-data cleanup. Missing display facts in this headless smoke mean rendering was unverified there; separate browser evidence provides page acceptance.
- **Installed browser demo passed:** [Open the retained demo](http://127.0.0.1:55253/?graph=realtime-agent-demo). [`installed-final-state.json`](evidence/realtime-agent-20261008/installed-final-state.json) records the installed service build at `R3`, with original geometry, unknown extensions, untouched-content digest and zero business runs. [`installed-qa.json`](evidence/realtime-agent-20261008/installed-qa.json) records a fresh actual Codex Q&A from the installed service and matching UI build. Only the isolated demo service was restarted.
- **Current primary host reload remains pending:** PID `61804` intentionally continues on r29.3. An installed-package smoke is not proof that this conversation's MCP process reloaded. After host restart, recheck `canvas_open` build/identity/revision before using new schemas on the primary project.

This source acceptance record was completed after installation. The immutable release package contains its earlier pre-installation record; these post-installation evidence files and the current source record are the final deployment results. No installed manifest bytes were edited to add later evidence.

## Out of scope for this acceptance

- Arbitrary new object or graph creation.
- Business execution, fabricated execution receipts, or treating chat status as a business run.
- A screenshot/video supplied as model input.
- A claim that the API adapter, Windows host, or every V1 platform has passed.
- A claim that the active primary host has reloaded r30.

The controlling product contract is [`REALTIME_AGENT_PLAN_2026-10-08.md`](REALTIME_AGENT_PLAN_2026-10-08.md); peer decisions and source attribution are in [`REALTIME_AGENT_PEER_REFERENCES_2026-10-08.md`](research/REALTIME_AGENT_PEER_REFERENCES_2026-10-08.md).

Published evidence copies replace machine-specific installation/source paths only. [The evidence manifest](evidence/realtime-agent-20261008/MANIFEST.json) records both original and published SHA-256 values. Live endpoints and PIDs are dated local observations, not portable deployment defaults.
