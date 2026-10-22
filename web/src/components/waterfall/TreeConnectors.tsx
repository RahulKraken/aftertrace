import type { SpanNode } from "../../lib/span"

export const TREE_PAD = 10
export const TREE_DEPTH = 20
export const TREE_CARET = 18
export const TREE_GLYPH = 18

export function glyphCenterX(depth: number): number {
  return TREE_PAD + depth * TREE_DEPTH + TREE_CARET + TREE_GLYPH / 2
}

// A parent's line drops from its count chip, and reaches a child at its chip
// when it has one, else at its icon: the rail never runs through a chip.
function chipCenterX(depth: number): number {
  return TREE_PAD + depth * TREE_DEPTH + TREE_CARET / 2
}

export function TreeConnectors({
  rows,
  rowH,
}: {
  rows: { span: SpanNode; depth: number }[]
  rowH: number
}) {
  const index = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) index.set(rows[i].span.span_id, i)

  const paths: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const parentId = row.span.parent_span_id
    if (!parentId) continue
    const pi = index.get(parentId)
    if (pi == null) continue
    const x0 = chipCenterX(rows[pi].depth)
    const x1 = row.span.kids.length ? chipCenterX(row.depth) - TREE_CARET / 2 + 1 : glyphCenterX(row.depth) - TREE_GLYPH / 2 - 1
    const y0 = pi * rowH + rowH / 2 + 8
    const y1 = i * rowH + rowH / 2
    const r = Math.min(5, Math.max(0, y1 - y0))
    if (y1 <= y0 + 1) {
      paths.push(`M ${x0} ${y0} L ${x1} ${y1}`)
      continue
    }
    paths.push(
      `M ${x0} ${y0} L ${x0} ${y1 - r} Q ${x0} ${y1} ${Math.min(x0 + r, x1)} ${y1} L ${x1} ${y1}`,
    )
  }

  const height = Math.max(rows.length * rowH, rowH)
  return (
    <svg className="tree-lines" width={glyphCenterX(8)} height={height} aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
