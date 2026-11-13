import type { DisplayBounds } from '@/shared/contracts/channels'

/**
 * Converts logical display bounds (Device Independent Pixels - DIPs)
 * to physical pixel dimensions based on the display's scale factor.
 */
export function toPhysicalBounds(logical: DisplayBounds, scaleFactor: number): DisplayBounds {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return {
    x: Math.round(logical.x * scale),
    y: Math.round(logical.y * scale),
    width: Math.round(logical.width * scale),
    height: Math.round(logical.height * scale)
  }
}

/**
 * Converts physical device pixel bounds to logical DIP bounds based on scale factor.
 */
export function toLogicalBounds(physical: DisplayBounds, scaleFactor: number): DisplayBounds {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return {
    x: Math.round(physical.x / scale),
    y: Math.round(physical.y / scale),
    width: Math.round(physical.width / scale),
    height: Math.round(physical.height / scale)
  }
}

/**
 * Determines whether a candidate device bounds matches a display's coordinates,
 * evaluating both logical DIP coordinates and physical pixel coordinates to account
 * for Windows DPI scaling (e.g. 100%, 125%, 150%, mixed-DPI multi-monitor).
 */
export function matchesDisplayBounds(
  candidate: DisplayBounds,
  target: { bounds: DisplayBounds; scaleFactor?: number }
): boolean {
  // Check exact logical bounds match
  const logicalMatch =
    candidate.x === target.bounds.x &&
    candidate.y === target.bounds.y &&
    candidate.width === target.bounds.width &&
    candidate.height === target.bounds.height

  if (logicalMatch) {
    return true
  }

  // Check physical and logical scaled bounds match when scale factor is present and != 1
  const scaleFactor = target.scaleFactor
  if (scaleFactor && scaleFactor > 0 && Math.abs(scaleFactor - 1.0) > 0.001) {
    const physical = toPhysicalBounds(target.bounds, scaleFactor)
    const matchesPhysical =
      candidate.x === physical.x &&
      candidate.y === physical.y &&
      candidate.width === physical.width &&
      candidate.height === physical.height

    if (matchesPhysical) {
      return true
    }

    const logical = toLogicalBounds(target.bounds, scaleFactor)
    return (
      candidate.x === logical.x &&
      candidate.y === logical.y &&
      candidate.width === logical.width &&
      candidate.height === logical.height
    )
  }

  return false
}
