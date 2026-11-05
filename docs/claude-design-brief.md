# Claude Design Brief: Content Workbench UI and Interaction Design

Act as the product designer for the existing open-source desktop application described below. Create a complete UI and interaction design that engineers can implement. Begin designing directly. When details are missing, use the defaults in this brief and explain your decisions. Prioritize an interactive high-fidelity prototype, complete interaction states, and implementation-ready specifications.

## Product and Users

Product name: Content Workbench. Preserve its existing Chinese brand name in the production interface.

Content Workbench is a local desktop workspace for individual developers. Users bring in Markdown written in Codex, Claude, or their project tools, organize it, preview it, and share it. They also read subscribed articles, capture their own observations, and turn notes into new drafts. The application itself does not require or integrate AI for these workflows.

Most users work independently and want to start writing, reading, or preparing a publication immediately. Everyday local use requires neither a workbench account nor model configuration. The application handles storage, platform adaptation, and recovery internally. Aim for a calm, clear, spacious experience that remains comfortable during a two-hour writing or reading session.

Technical constraints: Tauri 2, Rust, React, and TypeScript, inside a native macOS window. The current default window is 1180 by 800 pixels, with a minimum of 800 by 620. The implementation uses plain CSS and Lucide icons. You may deliver a standalone React prototype with deterministic demonstration data, clearly identified as a prototype. Production functionality will connect to the existing desktop APIs.

## Existing Capabilities and Honest Product States

| Area | Existing capabilities | Boundaries the design must communicate |
| --- | --- | --- |
| Drafts | Markdown import, creation, search, autosave, images, preview, history, archive and restore, export | Editor, history, and publishing previews share one rendering system, including math, Mermaid, code, tables, and heading anchors |
| Juejin | Publishing preview, heading-link adaptation, image preparation, copy-and-open, publication URL recording | Uploading images and completing publication currently happen on Juejin's website; copying content is not publication success |
| X | Implemented Client ID configuration, account connection, short-post editing, review and confirmation, publication receipts | A real account has not been validated, and the user has not created a developer application; disconnected states must offer an accurate next step |
| Reading | RSS and Atom, source filtering, cached-text search, read status, article bodies or summaries, notes, notes-to-draft | Refresh is manual; some sources supply only summaries; external images load on explicit request; arbitrary website full-text extraction is unavailable |
| Publication records | Saved publications, platform, time, manual confirmation or API receipt, opening the published page | Comments and view counts are not integrated; unavailable metrics must not appear as zero or as fabricated charts |
| Settings | Backup and restore, data location, platform connections, update checks, upgrade-backup access | Updates are checked automatically but installed after user confirmation; closing the app exits it, with no background collection |

The recorded public release baseline is 0.4.0; the local development baseline is 0.5.0-dev.1. The development version already preserves RSS headings, paragraphs, lists, code indentation, tables, and links. Keep that structured reading experience intact.

## Information Architecture and Visual Direction

Use three primary navigation destinations: Drafts, Reading, and Publication Records. Place Settings at the bottom. Publication Records corresponds to the existing page called Feedback; its underlying data and capabilities remain the same.

Use a light theme by default: warm off-white content surfaces, a subtly differentiated sidebar, dark gray text, and a restrained, low-saturation green accent. Establish hierarchy through typography, spacing, alignment, and whitespace. Use color for primary actions, selection, and meaningful states. Keep decorative surfaces, cards, and borders restrained. You may refine the palette, but deliver one coherent direction.

The production interface must be in Simplified Chinese. This brief uses English descriptions for navigation and actions; supply concise, natural Chinese UI copy in the actual design. Use local system fonts with clear distinctions between article content, code, and supporting information. Text and controls must be readable and comfortable on an ordinary laptop. Communicate states through more than color, keep keyboard focus visible, and use brief, subtle transitions with reduced-motion support. Complete the light desktop experience first; treat dark mode and mobile as later work.

Important constraint: article typography already has a Juejin comparison baseline, with 16px body text and a line height of 1.75. You may redesign interface headings, containers, backgrounds, and surrounding spacing. Preserve Markdown's internal typography, code indentation, formulas, diagrams, tables, and anchors. Global interface styles must not override these article styles. Do not promise pixel-identical rendering against Juejin's final published pages.

## Required User Journeys

### 1. Start Writing Immediately

On first launch, clearly offer Import Markdown and New Draft, with one short explanation of local storage. Once drafts exist, the list should make titles, update times, and relevant status easy to scan. Project association is optional and must never block writing.

When a draft is selected, its title and content should dominate the workspace. Make the editor/preview switch easy to find, and keep save status quiet but explicit. Prepare to Publish is the primary action. History, export, and archive should remain easy to discover as secondary actions. If saving fails, preserve the user's input and offer a nearby retry action; a temporary toast alone is insufficient.

### 2. Make Only Necessary Decisions Before Publishing

From a selected draft, enter publishing preparation, choose Juejin or X, and review the actual content being sent. Keep platform selection, account status, and the primary action visually connected. Avoid successive nested dialogs.

For Juejin, clearly identify the action as Copy and Open Juejin. Show image-preparation controls when images are present. Show a compact, expandable explanation when relevant formatting differences exist. After publishing on the platform, the user can paste the publication URL and save its record. Image-preparation failures must identify the affected image and provide a way to proceed after resolving the issue. Never show a false success state.

For X, show the final short post, destination account, and length limit. Design states for unconfigured, disconnected, awaiting authorization, connected, publishing, success, failure, and an uncertain delivery result. Present an actionable next step such as Connect X or Configure to Connect. Keep Client ID and similar setup details inside first-time connection details. When delivery is uncertain, guide the user to verify the result rather than encouraging a duplicate send.

Retain one explicit review and confirmation of content and account before final external publication. Preserve necessary confirmation even when minimizing clicks. Ordinary saving and reading require no confirmation dialogs.

### 3. Read Comfortably and Capture Notes Easily

Use an article list alongside the reading area by default. Place source filters, search, and unread filtering near the list. Refreshing subscriptions should be one clear action; adding a feed URL should not require a wizard.

Prioritize long-form reading with adequate width and continuous scrolling space. Specifically improve the current experience in which article content sits in an approximately 290px-tall box with nested article and page scrolling. Give the article one clear primary scrolling area. Long code blocks and wide tables may scroll horizontally within their own regions; the overall page must not overflow horizontally.

Clearly and concisely distinguish a supplied article body, a supplied summary, no supplied content, a legacy text-only cache, and truncated content. Keep Open Original available. Include usable states for images awaiting a load request, loading, load failure, and retry.

Notes should be readily accessible without squeezing the main reading column. Consider a collapsible notes area on wide windows and an inline disclosure or drawer on narrow windows. Switching articles, collapsing notes, and closing the application must preserve entered text. Turning notes into a draft must retain source attribution. Design list hierarchy for both 30 and 200 articles; this does not require introducing virtualization or new data services in this stage.

### 4. Find Publication Records After Sharing

Use a clear list showing the publication, platform, confirmation time, and confirmation source. Distinguish manually recorded publications from API-confirmed receipts without excessive visual weight. When metrics are unavailable, explain that the user can open the platform to view them. Do not add fabricated comment counts, views, or trend charts. The empty state should explain how the publishing workflow creates the first record.

### 5. Keep Settings Clear and Focused

Organize settings into Data and Backups, Platform Connections, and Application Updates. Put technical filesystem paths inside expandable details. Backup success should confirm that the file was saved. Restore failure must preserve existing data. The update area should communicate the installed version, available version, current status, and rollback access. Place a concrete next step near each error. Keep internal implementation details out of ordinary user flows.

## Layout, Interaction, and Evaluation Scenarios

Show layouts at 1440 by 900, 1180 by 800, and 800 by 620 pixels. Avoid excessively wide article lines on large windows. On smaller windows, preserve usable space through collapsible navigation or list/detail transitions rather than shrinking all typography.

The prototype must support these clickable journeys:

- Select a draft, switch between editing and preview, enter publishing preparation, and choose a platform.
- Select a subscribed article, read it, and write a note.
- Open Settings and inspect backup and update controls.

Clearly label simulated states for network actions that the prototype does not implement.

Specify Tab order, focus appearance, focus restoration after closing a dialog, Escape behavior where closing is safe, duplicate-action prevention during loading, recovery from save failures, long titles, empty content, partial subscription-refresh failures, and restore or update failures. Essential information and actions must remain available without hover.

## Deliverables

1. One coherent design direction, with a brief explanation of how it supports writing, reading, and publishing.
2. An interactive high-fidelity prototype covering Drafts, Reading, Publishing Preparation, Publication Records, and Settings, including key empty, error, and disconnected states. Refine Reading and Drafts first, then make the remaining areas consistent.
3. A design specification for colors, typography, spacing, radii, buttons, lists, inputs, dialogs, notices, disabled states, and focus states. Provide token names and values that map directly to CSS variables.
4. Per-page specifications for layout, scrolling, narrow-window adaptation, and primary and secondary action placement.
5. An engineering handoff with a component inventory, state tables, a mapping to existing capabilities, and a distinction between visual changes and additional interaction work. Separate demonstration data from real product capabilities.
6. If file export is supported, provide `ui-spec.md`, `design-tokens.css`, and prototype source. Use only public or synthetic sample data. Engineers will place these materials under `docs/design/` in the repository.

Conclude by demonstrating three complete scenarios: opening and selecting a draft, reviewing content before publication, and reading a long article while taking notes. Deliver the interactive experience and specifications, beyond aesthetic recommendations or a single landing-screen mockup.
