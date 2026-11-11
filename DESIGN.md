# Aftertrace design

Feeling words: **calm, exact, on your side.** Aftertrace is a local Mac instrument (Activity Monitor, Screen Time), not a dashboard. Honeycomb’s waterfall is the centrepiece when you open a turn. Colour is a family, not decoration. Motion is feedback, never a trick.

Read this before changing UI. The longer attention-budget notes that used to live in `docs/design-principles.md` are folded in below.

## Accent

- **System accent** is the only primary fill (selection, Copy fix, Show me). It stays the accent in dark mode.
- Primary controls go **inactive grey** (`--sel-inactive`) only when the window is inactive.
- **Amber** = cost you could get back (waiting on you, recoverable spend). Totals you already paid stay ink. Don’t reuse ribbon colours as unexplained dots on Findings.

## Type (9 tokens)

All in `web/src/styles/tokens.css`. No raw `font-size` outside that file.

| Token | Use |
|---|---|
| `--t-display` | Hero numbers |
| `--t-title1` | Finding / session titles |
| `--t-title2` | Inspector titles |
| `--t-num` | Secondary stats |
| `--t-headline` | Section heads |
| `--t-body` | Body |
| `--t-callout` | Secondary lines |
| `--t-caption` | Labels, table heads |
| `--t-toolbar` | Window titles |

## Radii (3)

`--r-control` (6px) controls, `--r-group` (10px) groups, `--r-full` pills. Aliases in tokens.css map leftover sizes so the lint can fail on raw px.

## Motion (named)

`--dur-press` 80ms, `--dur-select` 120ms, `--dur-ui` / `--dur-move` 140ms, `--dur-sheet` 180ms. Selection, sheets, list reorder only. Nothing over 200ms. `prefers-reduced-motion` is a hard stop. No entrance animations, no count-ups, no celebration.

## Numbers

One money rule: `usd()` — two decimals, `<$0.01`, no cents at $100+. Headline durations: `durHead()` (`49m`, `2m`); rows keep seconds via `dur()`. Shares under 1% are `<1%`. Week totals on Today and Spend come from the same overview window. Label **elapsed** (wall) and **agent** time apart on a running session.

## Copy

Sentence case. No caps eyebrows, no status chips. No session hashes in titles or crumbs. Pluralise (`1 session`, `2 sessions`). Don’t repeat a number in a second format.

## Screens

Today, Sessions, Findings, Spend share one language. Settings is a real Mac Settings window (~720×640): toolbar icon tabs, right-aligned labels, no search. Updates: “Version X is ready. Restart to update.”

## Attention budget

Every screen has about ten units of user attention. If two things both look important, cut one. Summoned UI (⌘K, tooltips, a zoom minimap) costs 0 until it appears.

## Open decisions

- Findings list no longer uses unexplained ribbon-coloured dots; section headers already group Money / Your time / Setup.
- Recap is Spend. The insight sentence leads; the model bar uses model colours and a legend.
- `token-lint` (`web/scripts/token-lint.mjs`) fails CI on raw `font-size`, `border-radius`, or `ms` outside `tokens.css`.
