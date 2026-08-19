export interface SwipeStart {
  pointerId: number;
  x: number;
  y: number;
  startedAt: number;
}

export type SwipeDirection = "next" | "previous";

const MIN_DISTANCE = 72;
const EDGE_GUARD = 24;
const MAX_DURATION = 900;

export function canStartSwipe({
  pointerType,
  isPrimary,
  x,
  viewportWidth,
  interactiveTarget,
}: {
  pointerType: string;
  isPrimary: boolean;
  x: number;
  viewportWidth: number;
  interactiveTarget: boolean;
}): boolean {
  return (
    pointerType !== "mouse" &&
    isPrimary &&
    !interactiveTarget &&
    x >= EDGE_GUARD &&
    x <= viewportWidth - EDGE_GUARD
  );
}

export function resolveSwipe(
  start: SwipeStart,
  end: { x: number; y: number; endedAt: number },
): SwipeDirection | null {
  const distanceX = end.x - start.x;
  const horizontalDistance = Math.abs(distanceX);
  const verticalDistance = Math.abs(end.y - start.y);
  const duration = end.endedAt - start.startedAt;

  if (
    duration < 0 ||
    duration > MAX_DURATION ||
    horizontalDistance < MIN_DISTANCE ||
    horizontalDistance <= verticalDistance * 1.3
  ) return null;

  return distanceX < 0 ? "next" : "previous";
}

