/** Collision-safe ids for decisions / exceptions (Date.now alone collides under batch). */
export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
