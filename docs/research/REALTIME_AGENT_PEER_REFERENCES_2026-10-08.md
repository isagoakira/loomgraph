# Real-Time Selection Agent: Peer Interaction Mechanisms and Local Trade-offs

Review date: 2026-10-08. Scope: the official public documentation for tldraw Agent Starter Kit, Miro AI, and Eraser / DiagramGPT, and the selection conversation controller being implemented in this project.

## Core assessment

The local interaction should remain **selected content → continuous conversation → in-place candidate → further revision or apply/discard**. There is direct support for this path in peer documentation: Miro’s diagram-generation documentation explicitly distinguishes a sketch from Apply to canvas and allows further prompts before applying; Eraser’s documentation explicitly supports selecting an existing diagram and describing changes in AI chat. [Miro diagrams and mind maps](https://help.miro.com/hc/en-us/articles/28782102127890-Miro-AI-with-Diagrams-and-mindmaps), [Eraser freeform diagrams](https://docs.eraser.io/freeform-diagrams)

The three most valuable improvements in this round are **readable before-and-after differences, complete preservation of the current user request, and explicit version and target identity during continued discussion of the same candidate**. There is no need to allow whole-graph writes, move the viewport by default, or add business execution states merely to resemble peers.

This report first reviewed the [existing interaction research from 2026-10-07](./AGENT_CANVAS_INTERACTION_REFERENCES_2026-10-07.md), then retrieved the official pages below again. “Officially confirmed” refers to pages retrieved in this round; “local observation” refers to current code; “recommendation” is an assessment of what to adopt.

## 1. Official evidence retrieved in this round

### tldraw: layered context and verifiable actions

**Officially confirmed:** Agent input includes user messages, selected shapes, the current view, additionally specified objects/regions, history, and structured shape information. The Starter Kit distinguishes overview shapes within the viewport, detailed shapes for explicitly focused objects, and aggregated information outside the viewport; modes determine which prompt parts and actions are available. [Agent Starter Kit](https://tldraw.dev/starter-kits/agent)

**Officially confirmed:** Actions have a schema, application logic, and a chat display; `sanitizeAction` handles invalid results before application and before saving history. The default starter modifies the editor directly as complete actions arrive and provides a cancellation capability. The page does not state that a universal “preview—accept” step is required for every action. [Agent Starter Kit](https://tldraw.dev/starter-kits/agent)

**Officially confirmed:** Store’s `RecordsDiff` separates additions, modifications, and deletions, with `[from, to]` on modified entries. This is a structure for recording differences, not a ready-made Agent approval interface. [RecordsDiff](https://tldraw.dev/reference/store/RecordsDiff)

**Recommendation:** Keep the current separation of “writable targets / read-only neighbors / omitted items,” narrow available operations by task mode, and validate identity and provenance locally before commit. Borrow the diff’s before-and-after display, but do not copy the default starter’s direct-write behavior.

### Miro: sketches during conversation, with explicit application or discard

**Officially confirmed:** Create with AI can use selected, non-hidden board content as context. After generation, the prompt panel remains open so users can continue prompting. [Create with AI](https://help.miro.com/hc/en-us/articles/20164358139794-Create-with-AI)

**Officially confirmed:** Diagram/mind-map generation first produces a sketch. Users can stop generation, Apply to canvas, Discard all, or continue describing changes in the sidebar until they apply it. This directly supports using “revise a candidate through conversation, then apply/discard” as an interaction reference. [Miro diagrams and mind maps](https://help.miro.com/hc/en-us/articles/28782102127890-Miro-AI-with-Diagrams-and-mindmaps)

**Officially confirmed:** AI text modification starts with highlighted text and a context menu, and supports specific actions such as shortening and rewriting. [Miro Docs and text](https://help.miro.com/hc/en-us/articles/28782201102354-Miro-AI-with-Docs-and-text)

**Officially confirmed:** Slides also lets users select a single slide for modification before applying, continue iterating, and finally Add to canvas. [Miro Slides](https://help.miro.com/hc/en-us/articles/30040238341906-Create-Miro-Slides-with-AI)

**Recommendation:** Keep the local candidate preview in the original viewport. The sidebar should make the distinction between “generated” and “written” clear. A change of selection should not silently replace the conversation target; offer an explicit switch. If text anchors can currently be handled only as whole objects, explain that granularity in the UI rather than presenting a paragraph selection as paragraph-level write protection.

### Eraser / DiagramGPT: continued modification of existing diagrams and stable edit provenance

**Officially confirmed:** Freeform diagrams can be modified on the canvas or with AI. The documented AI editing entry point is to select a diagram and describe changes in AI chat. Freeform is saved as JSON, while diagram-as-code uses a DSL; their editing paths and layout methods differ. [Freeform diagrams](https://docs.eraser.io/freeform-diagrams)

**Officially confirmed:** DiagramGPT’s public page supports Save and Edit Diagram after generation, followed by editing in Eraser. [DiagramGPT](https://www.eraser.io/diagramgpt)

**Officially confirmed:** An API edit source can be `priorRequestId` or the mutually exclusive `inlineCodeEdit`. Existing diagrams can also be updated through `targetFileId` and `targetDiagramId`. The API returns a stable diagram ID and `changed`, and states that `changed=false` means no modification was made. Freeform does not support `inlineCodeEdit` and does not return DSL code. [Prompt → Diagram API](https://docs.eraser.io/reference/generate-diagram-from-prompt)

**Recommendation:** Preserve proposal lineage and a source signature across local revisions; do not rely on a vague “previous result” in chat to identify the object. Detect unchanged candidates and respond directly that no modification is needed, rather than creating an empty revision. The API’s direct-write capability is not evidence that every Eraser UI provides preview and confirmation.

## 2. Peer mechanisms and their local counterparts

The local state below comes from source-code inspection in this round on 2026-10-08. The code is still being modified in parallel and cannot substitute for final installation or product testing.

| Question | Officially confirmed mechanism | Local observation | Recommended trade-off |
|---|---|---|---|
| What is the user referring to? | tldraw focused objects/overview/surroundings; Miro selection context; Eraser selection of an existing diagram | Scope freezes graph, targets, labels, and observedRevision; includes read-only neighbors and a budget | Keep the selection stable; if viewport observation is added later, keep it read-only and do not infer additional write permission |
| Which version is being discussed continuously? | tldraw records conversation and actions; Miro allows further prompts before application; Eraser specifies an edit source | When a candidate exists, its temporary preview is the source for the next turn; the source signature is checked before application | Revise the same candidate continuously and show its identity and source changes; targets deleted in a candidate should remain discussable |
| What can the model change? | tldraw modes restrict parts/actions, and action sanitation checks targets | Local operation allowlist, strict target set, representation preflight, and store preview | Continue local validation; keep operations empty in the Q&A schema, and list only currently permitted operations in the modification schema |
| When is generated content written? | Miro diagrams explicitly distinguish sketch / Apply / Discard; tldraw’s default streamed actions apply directly | Candidate previews do not change the content revision; apply produces a changeId/revision | The current preview and explicit-apply path most closely matches Miro’s sketch mechanism |
| Can users tell what changed? | tldraw RecordsDiff has before-and-after values; Miro displays sketches on the canvas | An in-place preview exists; the sidebar change list mainly shows operation types and object names | Add field-level before/after values and emphasize deletions and geometry changes; do not show only internal operation names |
| What if nothing actually changed? | Eraser API explicitly reports changed=false | Whether semantically unchanged patches are filtered still needs checking | Do not create a content revision for no change, and make that clear in the response |

## 3. Prioritized recommendations and acceptance criteria

### P0: Ensure the current request matches the actual write boundary

These are correctness requirements for the local implementation, not verbatim rules from peer documentation.

1. Include the complete current user instruction in model context. If the interface permits 12000 characters, it should not send only the first 3000 to the model. Prioritize the current request in the budget, and make truncation of older history visible.
2. Reserve a request slot before the first asynchronous preparation step. Cancellation must cover both preparation and execution; do not start a new process after closure.
3. Application and discard must be mutually exclusive. Once writing begins, discard must not report success to the user before an asynchronous commit subsequently writes the candidate.
4. Applying a candidate must still check explicit targets, native identity, source signature, and a trustworthy transaction result. A peer’s streaming animation does not authorize local writes.

### P1: Make the in-place preview a readable change review

Users should be able to see “which object, which field, old and new values, whether it is deleted, and how its geometry changes,” as well as which earlier candidate the new candidate is based on. The in-place canvas preview and a concise field diff complement each other; long metadata can be collapsed, with semantic text and change types shown first by default.

Acceptance: From the sidebar alone, users can distinguish changing an explanation, moving a node, and deleting the selected representation. After application, a real changeId/revision appears; after discard, the original content remains. No empty version is created when nothing changes.

### P1: Preserve context across continuous revisions

Miro allows further prompts before application, and the Eraser API explicitly identifies the edit source. Locally, when a target is temporarily removed from a candidate, its original target identity should remain available for discussion; the user should still be able to ask “why was it deleted?” even though the temporary source no longer contains the object. A stable baseline + candidate diff can represent this state.

Acceptance: After generating a deletion candidate, users can still ask questions or request restoration. After successive modifications, cumulative operations still respect the budget and selection. If the original source changes, require regeneration rather than silently applying an old candidate.

### Later: Add visual context when the task requires it

tldraw confirms the use of screenshots together with structured data. The local implementation currently relies mainly on bounded structured representations. If a task requires judging crowding, alignment, or reading direction, add browser observation of the current viewport and measured facts; state in the context summary whether visual input was actually provided. Screenshot capability is outside this round’s delivery scope.

## 4. Evidence from implementation review in this round

This round made no code changes, ran no second model, and called no paid peer API. The current controller was tested with an in-memory build and a fake provider to avoid rewriting project data.

- On recheck, all four cases were rejected: native element ID collisions, cross-graph entities, mismatched entity/representation identities, and cross-graph relationships.
- With two concurrent sends, the second was rejected; the fake provider was called only once.
- When closed during provider-information preparation, the fake provider’s actual run call count was zero.
- Source review confirmed that subscription registers the listener before immediately emitting the current session; the selected graph enters the full source budget; cumulative candidate operations are checked again; and graph-level relationship expansion filters out explicit ownership by other graphs.
- Truncation of the current user text and the commit/discard race were reported to the main agent. Subsequent source review confirmed that the latest user message is retained in full, discard is disabled during commit, and application is disabled after closure. The main agent is responsible for new tests and final product acceptance.

## 5. Evidence boundaries

The peer behavior above comes from public official documentation; no logged-in interaction testing was performed in those products. There is no evidence that peers generally use the same revision, conflict merging, scoped write permissions, or CLI isolation strategy as this project. Eraser’s API editing does not prove an in-place temporary preview; tldraw’s RecordsDiff is not a universal approval process. Whether the local functionality has been released, installed, connected to an actual model, or passed browser acceptance should be determined by the main agent’s final testing.
