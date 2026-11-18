export type DropTarget = { dir: string; index: number }

/** Insertion point for a drop. `overIndex` null = no row hovered (empty folder or folder body). */
export function computeDrop(
  overDir: string,
  overIndex: number | null,
  position: 'before' | 'after',
  length: number
): DropTarget {
  if (overIndex === null) return { dir: overDir, index: position === 'after' ? length : 0 }
  return { dir: overDir, index: position === 'after' ? overIndex + 1 : overIndex }
}

/** moveRequest inserts into the list without the dragged item, so shift for same-folder moves downwards. */
export function moveIndex(target: DropTarget, fromDir: string, fromIndex: number): number {
  return target.dir === fromDir && fromIndex < target.index ? target.index - 1 : target.index
}

/** Dropping a row on itself or right after itself changes nothing: skip the moveRequest call. */
export function isNoopMove(src: { dir: string; index: number }, target: DropTarget): boolean {
  return target.dir === src.dir && (target.index === src.index || target.index === src.index + 1)
}
