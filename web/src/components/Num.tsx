// Plain formatted number. Count-ups are not part of the instrument.
export function Num({ value, format }: { value: number; format: (n: number) => string; duration?: number }) {
  return <span className="n">{format(value)}</span>
}
