import { modelFamily, modelSlug } from "../lib/model"

export function ModelChip({
  model,
  className = "",
}: {
  model: string | null | undefined
  className?: string
}) {
  if (!model) return null
  const fam = modelFamily(model)
  const slug = modelSlug(model)
  return (
    <span className={`v4-mc ${fam} ${className}`.trim()} title={model}>
      <i />
      {slug}
    </span>
  )
}
