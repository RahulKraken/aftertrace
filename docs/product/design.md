# Design

How Aftertrace looks and behaves, and why. The attention budget in [design-principles.md](../design-principles.md) still governs every screen; this document adds the information architecture and the principles each screen is checked against.

## Information architecture

A left sidebar with three labelled groups, so the eight destinations read as three jobs instead of a flat list.

| Group | Pages | The job |
| - | - | - |
| (top) | **Home** | What is happening, and what happened this week |
| Observe | **Sessions**, **Apps** | Look at what ran |
| Improve | **Findings**, **Cost** | Decide what to change |
| Explore | **Query**, **Recap** | Ask anything; see the week |
| (bottom) | **Connect**, **Settings** | Add a source; tune the instrument |

A trace opens from anywhere: a session row, a finding's evidence chip, a live lane, an Ask answer, ⌘K. The sidebar collapses to icons below 1100px and to a top bar on phones.

## Norman's principles, applied

Each principle names the concrete decisions it drives. A design change that breaks one of these needs a reason.

**Discoverability (visibility).** You can tell what is possible by looking.
- Every sidebar item shows a live count where one matters: running sessions, open findings, apps.
- The inspector's resize handle shows a line on hover; its close button is visible, not hidden behind Esc.
- Keyboard shortcuts are printed next to the actions they trigger and in the ⌘K list.
- Empty states say what will appear and how to make it appear.

**Feedback.** Every action and every state change is acknowledged, at the speed it happened.
- Live lanes pulse while spans arrive and say "quiet for 2m" when they stop.
- Connect confirms the first span on the same page ("First span from claude-code, 2s ago"), with a link to it.
- Copying anything shows a check and a toast. Resolving a finding moves it to the ledger with its number.
- Long work (Ask) says what it is doing and how many queries it ran.

**Affordances and signifiers.** Things that act look like they act.
- Rows that open something have a hover state and a chevron on hover; static text does not.
- Evidence chips look like chips (bordered, mono id) because they navigate.
- Drag handles are cursor `col-resize` with a visible line; disabled controls say why in a tooltip.

**Mapping.** Controls sit next to what they change, and the layout mirrors the thing it shows.
- A turn is told the way you think about it: steps, each an intent ("Now writing the service command") with the actions under it, not spans. The span tree is one click away as the Timeline.
- The Timeline's time axis is shared by every row; the inspector is to the right of the row it describes. A long wait for a person folds into a labelled band, so the axis maps to the work, not to the half hour you were away.
- Each bar carries its own time and cost right beside it; a clicked bar opens its card right under it.
- Live lanes are ordered by start time, left to right in time, top to bottom by session.
- Colour maps to one meaning each: amber waiting on you, rose failure or retry waste, blue model, green tools.

**Constraints.** It is hard to do the wrong thing.
- Raw SQL is read-only by construction (sandbox), and the page says so.
- Ask is off until switched on; the UI cannot send data out by accident.
- Content capture is opt-in at two gates (Claude Code flags and `--store-content`); Settings shows which gates are open.
- Destructive actions (purge) need typing the word.

**Consistency.** Same thing, same look, everywhere.
- Tables use one duration format (`1m 06s`), one money format (`$0.42`), one token format (`39.0k`), all tabular mono. Sentences use spoken forms (`49 min`, `41¢`, `12M`).
- One status vocabulary: Running, Quiet, Done, Incomplete, Failed.
- A session is titled by its first prompt everywhere it appears.

**The gulf of evaluation on a trace.** The first waterfall answered "what happened?" with 146 identical rows on a linear axis; a 30-minute question to the user was a green sliver nobody could find, and the headline called it "waiting on approvals". The Story view closes that gulf: the headline says what happened ("Claude waited 29m 38s for your answer. The work itself took 12m 54s."), the time bar says where it went in words, the outcome comes before the steps, and the wait is a card with the questions and answers. Steps use Claude's own narration (the `assistant_response` text on each model call) when content capture is on, and a summary of the work ("Read 4 files · Ran 2 commands") when it is off.

**Conceptual model.** The user's mental model is: *sources* send *sessions*; a session has *turns*; a turn is a *trace* of *spans*. Apps send *calls* grouped by *operation*. Findings point at spans. Every screen uses these words and no others.

## Emotional design

**Visceral: a calm instrument.** Neutral surfaces, one accent, hairline borders, generous line height in prose, tight density in tables. Numbers are mono and right-aligned. Dark mode is designed, not inverted. Motion is limited to the live pulse, panel slides and skeletons, and respects `prefers-reduced-motion`.

**Behavioral: fast and never a dead end.** Pages render from cache instantly and refresh in place. Every list row and every number opens what is behind it. Keyboard first: ⌘K, `g h` for home, `j`/`k` in lists, `[` `]` between turns, Esc closes. Errors say what to do next.

**Reflective: it makes you proud of your setup.** The recap is a receipt you would post: hours of agent work, the plan paying for itself, the minutes a fix gave back. The savings ledger turns findings into a running total. Fun numbers always come with a baseline and an action, never as vanity.

## Visual system

| Token | Value |
| - | - |
| UI text | 13px Inter, 1.45 line height |
| Labels | 11px, uppercase, 0.05em tracking, faint |
| Headline (story line) | 22–26px, 600, tight tracking |
| Numbers | tabular mono, 12–13px |
| Radius | 8px cards, 6px controls, pills fully rounded |
| Borders | 1px hairline; shadow only on floating layers (popover, toast, palette) |
| Accent | one blue for selection and focus; status colours never decorate |
| Density | table rows 32px; waterfall rows 32px; inspector padding 16px |

## Patterns

- **Story first.** Home, Sessions and Recap open with one sentence that states the most important fact, then the numbers.
- **Stat strip, not tiles.** A single row of 4–5 numbers with small sparklines and week-over-week change.
- **Live lane.** Dot (pulsing while running), session title, what it is doing now, elapsed, cost so far.
- **Inspector.** Header with close; phase bar; metrics grid; input and output; transcript (turns); events; attributes; raw.
- **Finding card.** Impact in the sentence, evidence chips, the fix to copy, Mark resolved.
- **Connect step.** Numbered steps; tabs per variant; copy on every block; a "listening" card that turns into "received" in place.
