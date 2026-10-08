# In-canvas real-time Agent and selection-context redesign

Date: 2026-10-08. Status: **restricted first-stage acceptance**. This plan is the product contract and next-step boundary; the evidence and pass/pending decisions are recorded in [REALTIME_AGENT_ACCEPTANCE_2026-10-08.md](REALTIME_AGENT_ACCEPTANCE_2026-10-08.md). This round must not be described as complete V1.

User authorization: integrate grid alignment, object snapping, and focus mode; upgrade selection → Ask Agent into a small dialogue window for real-time answers/actions and previews based on selected context. Prefer CLI adapters for Codex / Claude Code; use model configuration when no CLI exists. Selection-context management is a core requirement.

## First-stage decision

The tested local interaction is deliberately constrained:

1. Freeze the explicit selection when the dialogue opens.
2. Read one-hop neighbours, terms, organization paths, and sources as context only; they are read-only unless the user explicitly switches or expands scope.
3. Keep Q&A separate from structured change proposals.
4. Show a candidate in the original canvas, retain the target identity and source revision, and allow continuous refinement of that candidate.
5. Require explicit Apply or Discard. Apply creates one receipt-backed revision; replay is idempotent. Undo is a new revision that follows the existing receipt/history path.
6. Keep the panel movable, resizable, and collapsible. Keep grid alignment, object snapping, and focus mode as distinct controls.

The first action set edits existing selected content, representations, relationship descriptions, and text/free elements within the controlled operation allowlist. Arbitrary object/graph creation and business execution are outside this stage.

## Product interaction

1. Ask Agent opens a movable, resizable small window, preserving canvas panning and reading space.
2. Show selected-target labels, content revision, and actual backend. A changed selection does not silently replace the objects under discussion. Explicitly switch to the current selection to start discussion in that scope.
3. Separate Q&A from change proposals. Consecutive messages retain scoped context. Freeze current content once per turn and show referenced neighbours, budget, and omissions.
4. Display replies and actual backend events in real time. Proposals appear on the same canvas after operation, scope, and expression validation. Previews create no content revisions; refine through follow-up, apply, or discard.
5. Application preserves stable identities, unknown metadata, pins, and camera. Retry with the same operation ID. Context conflicts require a refreshed candidate instead of overwriting new content.
6. Retain independent annotations and batch handoff as supplementary entries.

## Context contract

- Session identity: projectId + workCopyId + graphId + frozen targets; coordinates, titles, and pointer position are not identities.
- targets define writable scope. One-hop neighbours, terminology, organization paths, and sources are context only. Only explicitly switched/expanded scope adds editing responsibility.
- Every turn includes current revision, observed selection revision, expression mainline, node body/diagrams, relation explanations, pinned geometry, reference identities, and omissions. Isolate source material and discussion as quoted data.
- Bound selection count, body/neighborhood length, history turns, concurrent processes, output size, and runtime. Make truncation visible. Missing essential targets must not silently broaden editing to the whole graph.
- Permit only controlled content/geometry proposals. Reject generated execution receipts and unrelated project-state changes. Business execution and chat-process status remain separate.
- For multiple representations of one object, content is shared; geometry changes affect only explicitly selected representations. Explain shared-content effects to users.
- A staged removal retains the original selected identity and body in discussion context, with an explicit pending-removal list. A bounded proposal.restore request can withdraw only that candidate's selected removal; it cannot create an object.
- Candidate lineage carries parentId. Readable before/after fields accompany the original-canvas preview. Semantic no-ops, including withdrawal back to the baseline, produce no project revision.

## Peer decisions

The [official-source comparison](research/REALTIME_AGENT_PEER_REFERENCES_2026-10-08.md) supports these choices: Miro supplies the sketch/refine/apply/discard interaction; tldraw supplies focused versus surrounding context, action sanitation and before/after differences; Eraser supplies stable edit sources and changed=false semantics. tldraw's default streamed actions apply directly, so its starter is not evidence that every peer requires preview acceptance.

Opening a dialogue does not start a model. Preparation, actual provider events, completed candidate and committed content have distinct records. On a source conflict, the temporary view is removed and the user retains the discussion. Only a confirmed current preview is applicable from the panel. Session bindings include observedRevision; an explicit switch can refresh the same target at a new revision.

## Modules

- UI: AgentChatPanel for dialogue, context inspection, backend selection, and proposal actions. App manages temporary canvas projection without losing annotations.
- Agent runtime: on-demand CLI/API providers, frozen context, session events, cancellation, and records. Authentication remains on the local server.
- Providers: Codex CLI / Claude Code CLI reuse local login and model routing, adapting actual event capabilities. Configured model services are explicit fallback options. No simulated streaming or execution.
- Preview: the same core operation/snapshot validators as committed writes; temporary projections do not write or advance revisions.
- Commit: candidate IDs, baseline checks, revision protection, idempotent application, and actual changeId receipts.
- Modes: public SDK state is authoritative. Card dragging/resizing uses grid and edge/center snapping. Focus mode derives outer-interface visibility and restores previous preferences. Provide a Chinese application menu, retain the SDK menu, and avoid private APIs or dependency patches.

## Gate status for this round

| Gate | Status | Evidence or remaining boundary |
|---|---|---|
| Explicit targets, one-hop read-only neighbours, and rejection of unrelated/execution writes | **Accepted** | Controller tests and the actual scoped browser flow. |
| Q&A and candidate preview create no revision; Apply writes once; replay is idempotent; receipt-backed Undo returns through history | **Accepted for isolated local demo** | `R1` baseline → preview/refine at `R1` → Apply `R2` → Undo `R3`; see the acceptance record and `docs/evidence/realtime-agent-20261008/*-state.json`. |
| Continuous refinement keeps the same candidate lineage and source identity | **Accepted for the tested local path** | Browser refinement plus controller lineage tests. Draft isolation across an explicit selection switch is recorded separately in `scope-and-panel.json`. |
| Cancellation and no residual business execution | **Accepted for tested local CLI/browser path** | Codex/Claude local smoke and browser Claude stop. Cross-host runtime remains unverified. |
| Codex CLI and Claude Code CLI invocation and event parsing | **Accepted on the local host** | Actual [`codex-cli-smoke.json`](evidence/realtime-agent-20261008/codex-cli-smoke.json) and [`claude-cli-smoke.json`](evidence/realtime-agent-20261008/claude-cli-smoke.json). |
| Configured API provider and Windows host | **Unit tests only** | No real endpoint or Windows machine acceptance in this round. |
| Grid alignment, object snapping, focus mode, and movable/resizable panel | **Accepted for the tested local path** | Installed-page mode switches are recorded in `final-modes.json` and `final-ui.png`; drag/resize and scope drafts in `scope-and-panel.json`. Card snapping has targeted unit coverage; not all drag variants were browser-tested. |
| Selection switch with retained drafts | **Accepted for the tested local path** | [`scope-and-panel.json`](evidence/realtime-agent-20261008/scope-and-panel.json) records explicit switch to candidate preview, an empty new draft, switch back, and restoration of the original unsent draft. |
| r30 installation | **Accepted** | `installation.json`: build `realtime-agent-20261008-r30`, archive/951-file verification and atomic pointer; `installed-r30-smoke-result.json`: real isolated stdio checks and clean shutdown. |
| Installed r30 browser service | **Accepted** | The isolated demo remains at port 55253 and R3; matching server/UI build and fresh actual Q&A in `installed-final-state.json` / `installed-qa.json`. |
| r30 current-primary-host reload | **Pending host restart** | Primary PID `61804`, R200 and r29.3 remain unchanged. A later `canvas_open` must verify host reload; package installation and isolated smoke do not prove it. |
| Final mode rendering artifact | **Accepted on the local page** | `final-modes.json` and `final-ui.png` record current installed-page modes; `modes-debug.png` is historical diagnosis only. |

## Evidence boundary

The fake provider used by controller tests is a control-layer adapter and never runs a model. It proves scope, validation, revision, cancellation, and transaction semantics only. The actual CLI smoke files prove that local Codex and Claude executables started and returned structured output under the isolation flags; they do not prove an API endpoint, Windows, or model quality. The browser run proves the UI and local CLI-backed lifecycle; its screenshots prove page rendering, not screenshot input to the model. These layers are intentionally reported separately in [REALTIME_AGENT_ACCEPTANCE_2026-10-08.md](REALTIME_AGENT_ACCEPTANCE_2026-10-08.md).

## Status and next steps

This is a constrained first-stage acceptance, not complete V1. r30 is installed and the installed local demo/stdio path is accepted; the current primary host intentionally remains on r29.3 until restart. Further acceptance should add post-restart primary-host evidence, real configured API and Windows/other-platform runs. Arbitrary creation, paragraph-level protection and model visual input require separate implementation and acceptance without weakening the existing scoped context contract.
