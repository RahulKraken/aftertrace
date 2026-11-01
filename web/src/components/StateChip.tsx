export function StateChip({ running }: { running?: boolean }) {
  return (
    <span className={`v4-st${running ? "" : " done"}`}>
      <i />
      {running ? "Running" : "Done"}
    </span>
  )
}
