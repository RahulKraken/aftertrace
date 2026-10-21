# Aftertrace design principles

Aftertrace is a local profiler. It should feel like a calm instrument, not a dashboard. Honeycomb’s waterfall is the centrepiece: clean rows, a shared time axis, one number on the row. Colour is a family, not decoration. Motion is feedback, never a trick. `prefers-reduced-motion` is a hard stop.

Every change in `web/` should be traceable to a line below.

## 0. The attention budget (governs everything)

A rider has about ten units of grip, split between braking, turning and accelerating. Spend more than ten and the bike is gone. Every Aftertrace screen has the same ten units of user attention. Every element on screen spends some. Sometimes all ten go to one thing. Sometimes they are split on purpose. **Never ask for more than ten.**

Summoned UI (tooltips, ⌘K, the icon legend, a zoom minimap) costs **0 until it appears**. Quiet list chrome can share a small allocation; it must not grow a second focal point.

If two things both look important, the budget is already blown. Cut one.

### Waterfall — default (no span chosen)

| Element | Units | Why |
|---|---:|---|
| Waterfall bars | 6 | This is the instrument. Time is the object. Pastel tints, tree on the left. |
| Turn summary sentence | 2 | English first: what this turn cost you. |
| Header (crumbs, quiet totals, Time \| Cost) | 1 | `3m 48s · $2.56 · 33 calls` — and `· 1 error` in red only when it happens. Not six KPI tiles. |
| Detail panel | 1 | Present but not claiming the page; closed until a span is chosen. |
| Minimap | 0 | Hidden until you zoom, or the turn has more than 50 spans. |
| Hover popover, icon legend, ⌘K, crosshair | 0 | Summoned on hover / key. |
| Live playhead | 0 | Only while spans are still arriving (or during mock replay). |

### Waterfall — a span is selected

| Element | Units | Why |
|---|---:|---|
| Detail panel | 5 | The question is now *this* span. |
| Waterfall bars | 4 | Context for the span; no longer the whole story. |
| Header, sentence, the rest | 1 | Orientation only. |
| Minimap | 0 | Still hidden unless zoomed or >50 spans. |

### Sessions

| Element | Units | Why |
|---|---:|---|
| One-line weekly story | 7 | The week, in English. Not a dashboard. |
| Sessions list | 3 | Pick a session. Quiet columns, no KPI tile row. |

### Session (one session)

| Element | Units | Why |
|---|---:|---|
| One-line session story | 7 | What this session was. |
| Turn list | 3 | Pick a turn. No KPI tiles. |

### Findings

| Element | Units | Why |
|---|---:|---|
| Top finding + Fix | 10 | One change you can make. Everything else is a quiet list. |

### Fix / win moment

| Element | Units | Why |
|---|---:|---|
| The number from the finding | 10 | Prompts removed, minutes saved — a bottom-right toast over the still-visible list, then that finding marked resolved. |

### Query

| Element | Units | Why |
|---|---:|---|
| Builder (or Ask / SQL) | 6 | One way of asking. |
| Result (chart *or* table) | 4 | The answer. Traces wait until you click a point. |

### Cost

| Element | Units | Why |
|---|---:|---|
| Table | 8 | The breakdown *is* the page. |
| Dimension switcher | 2 | How you slice it. |

### Empty

| Element | Units | Why |
|---|---:|---|
| Setup recipe + copy | 8 | The next action. |
| Page heading | 2 | Why the machine is quiet. |

## Emotional Design

### Visceral — beautiful before you read

1. **Cool grey shell, white content.** The page is `#f7f7f8` with pure white cards. No warm or yellow cast. Colour is reserved for span families, the wait hatch, and the win. Waterfall bars are pastel tints of the family hue (about 14% fill, 1px stronger edge); waiting-on-you stays crisp amber, the one warm element.
   *Aftertrace: tokens `--bg` `#f7f7f8`, `--surface` `#ffffff`; `.bar` via `--bar-hue`; `.ph-wait` as 90° orange bands.*
2. **One grotesk for everything.** Inter, self-hosted as latin woff2 in `web/src/fonts/` (no CDN). Tabular numerals on numbers. Mono is only for IDs and code.
   *Aftertrace: `--sans: "Inter"` on headings, the weekly sentence, the win figure, and chrome.*
3. **Hairlines, not shadows.** The docked pane and the hero finding are 1px borders and an 8px radius. KPI tiles are gone; they were a second focal point. The win toast is the exception: a soft shadow so it sits on the page instead of overlapping it.
   *Aftertrace: `--line` `#ebebeb`; `--shadow` none; `--shadow-toast` on `.win-face`; `--radius` 8px.*
4. **Every session has a shape.** You should recognise a session the way you recognise a skyline — as quiet list chrome, not a competing column.
   *Aftertrace: a mini-waterfall glyph inline on the session row, painted from that session’s time mix.*

### Behavioral — pleasure through control

5. **Brush to zoom, double-click to reset.** Time is the object you hold.
   *Aftertrace: drag on the ruler (handles on the brush); double-click the ruler or minimap to return to the full turn.*
6. **A session minimap you can scrub — only when you need it.** The whole turn stays in view while you inspect a slice.
   *Aftertrace: hidden until `view` is set or there are >50 spans; the viewport rectangle is the thing you drag.*
7. **A crisp crosshair with a timestamp.** Hover is a measurement, not a glow.
   *Aftertrace: 1px hairline + clock label on the ruler, summoned on hover (0 until then).*
8. **Evidence glides, it does not cut.** Jumping from a finding lands on the span with context intact.
   *Aftertrace: ancestors expand, the row scrolls into place, the pane opens (selected budget), a one-shot highlight. Reduced motion skips the glide.*
9. **Skeletons shaped like the thing that is coming.** Waiting should still look like a waterfall.
   *Aftertrace: `WaterfallSkeleton` — label column + staggered bars, not a spinner.*
10. **Every interaction answers within 100ms.** Click, copy, filter, run, theme: a visible change on the same frame or the next. Collapse springs children away and fades in a `+N` pill; live replay stretches in-flight bars with the playhead.
    *Aftertrace: CSS transitions ≤ 140ms; the win stage appears on Fix; queries show a running state on the button. `useReplay` at 4× in mock (`?replay=1`). `prefers-reduced-motion` skips both.*
11. **⌘K / Ctrl-K is how you move.** Pages, sessions, and findings are a command away.
    *Aftertrace: `CommandPalette` over the shell, summoned only; no header chip.*

### Reflective — meaning and self-image

12. **Fix is a real act.** A finding is not a lecture; it is a change you can copy.
    *Aftertrace: the top finding has **Fix** — the exact `settings.json` snippet or env.*
13. **Aftertrace remembers the win.** After a fix, all ten units go to the number that finding earned, as a bottom-right toast with settle motion. The list stays visible underneath. About 1.5s later the toast goes, with that finding marked resolved.
    *Aftertrace: `WinStage` reads `fixFor(f).win` — for the npm-test allow rule, **6** prompts removed, **1m 29s** saved. Mock seeds finding id 4 as already resolved.*
14. **A sentence at the top of a session and a turn.** The instrument speaks in English first.
    *Aftertrace: `sessionStory` / `turnStory` — e.g. “You spent 23% of this turn waiting on approvals.”*
15. **The sessions page tells a weekly story in one line.** Not three tiles. The 23% carries one crisp orange underline, proportional to the value.
    *Aftertrace: `weekStory()` / `.week-pct` — “You spent 23% of this week waiting on approvals, and saved 11 min.”*

## The Design of Everyday Things

16. **Signifiers and affordances.** Hover is obvious. Carets look like carets. The pane divider shows `col-resize`. The brush has handles you can grab.
    *Aftertrace: `:hover` on rows/buttons; chevrons on collapsed rows; `.pane-resizer`; `.brush-handle`.*
17. **Mapping.** Bar colour, row icon, and detail-pane header are one hue. The pane’s timing breakdown is a mini bar that mirrors the row’s segments.
    *Aftertrace: `hueVar(span)` on glyph, bar, and `.pane` accent; `Phases` in the pane reuses the same paint as the row.*
18. **Feedback.** Every click, copy, filter, and run leaves a mark.
    *Aftertrace: win stage on Fix; buttons show `Copied` / `Running`; filters highlight; SQL errors sit on the card.*
19. **Conceptual model.** Session → turn → span is named in the breadcrumb. The icon language is a legend on hover. The minimap draws the turn only when zoomed.
    *Aftertrace: crumbs `Sessions › {id} › Turn n`; `IconLegend` on the “span” label; minimap on demand.*
20. **Constraints.** The query builder only offers attributes, operators, and values that exist.
    *Aftertrace: field list from `/api/fields`; operators by `num`/`str`; value autocomplete from `/api/field-values`.*
21. **Error prevention and recovery.** Filters undo. SQL is read-only and says so. Errors say what to do next.
    *Aftertrace: undo on the builder (and ⌘Z); SQL banner; mock SQL errors append a next step.*
22. **Knowledge in the world.** Units are printed. Effort and cache tokens explain themselves on hover. The empty state teaches the setup, with copy.
    *Aftertrace: `ms` / `$` on list columns; tooltips on `effort` and cache; empty-state copy buttons on `aftertrace init` and the settings snippet.*

## Cuts (do not spend budget on these)

- Weekly KPI tiles and sparklines (`WeekStory` cards).
- A KPI row on Sessions or Session.
- Per-row session stories (the page already has the week sentence).
- A dedicated Shape column (the glyph sits in the list’s 3 units).
- Waterfall chips (model / tool / wait) — the sentence already said it.
- Waterfall request / cost subtitle next to the turn title.
- Six KPI tiles on the waterfall (Flo’s header). One quiet totals line instead.
- Two numbers on every waterfall row. Time \| Cost picks the one number.
- A generic SLOWEST badge. The marker is the bottleneck finding, and a click is evidence.
- Always-on `j k ↵ esc` hint strip.
- ⌘K chip and `127.0.0.1` tag in the header.
- Minimap in the default waterfall.
- Detail pane open by default (it opens when a span is chosen, or when a finding lands you on one).
- Findings win banner and a Wins group as a second focal point.
- Fix snippet / Fix button on every finding (only the top one).
- A copy toast on Fix (the win stage *is* the feedback).
- A blurred, dimmed-modal win overlay. The page stays visible; the win is a bottom-right toast.
- Mini-waterfall + split bar together on the session turn list (one quiet glyph).

## Non-goals

No confetti. No extra inline numbers on waterfall rows. No permanent legend strip. No motion if the user asked the system not to move. Never more than ten units on one screen.
