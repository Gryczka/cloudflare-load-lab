export interface MarkerLabelAnchor {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarkerLabelOffset {
  x: number;
  y: number;
}

interface Rectangle {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const LABEL_MARGIN = 4;
const COLLISION_PADDING = 3;

export function layoutMarkerLabels(
  anchors: MarkerLabelAnchor[],
  bounds: { width: number; height: number },
): Map<string, MarkerLabelOffset> {
  const offsets = new Map<string, MarkerLabelOffset>();
  const placed: Rectangle[] = [];

  for (const anchor of anchors) {
    const vertical = 11 + anchor.height / 2;
    const horizontal = 11 + anchor.width / 2;
    const candidates: MarkerLabelOffset[] = [
      { x: 0, y: vertical },
      { x: 0, y: -vertical },
      { x: horizontal, y: 0 },
      { x: -horizontal, y: 0 },
      { x: horizontal * 0.72, y: vertical },
      { x: -horizontal * 0.72, y: vertical },
      { x: horizontal * 0.72, y: -vertical },
      { x: -horizontal * 0.72, y: -vertical },
    ];

    let selected = candidates[0] as MarkerLabelOffset;
    for (const candidate of candidates) {
      const rectangle = labelRectangle(anchor, candidate);
      if (
        insideBounds(rectangle, bounds) &&
        placed.every((existing) => !overlaps(rectangle, existing))
      ) {
        selected = candidate;
        break;
      }
    }

    offsets.set(anchor.id, selected);
    placed.push(labelRectangle(anchor, selected));
  }

  return offsets;
}

function labelRectangle(
  anchor: MarkerLabelAnchor,
  offset: MarkerLabelOffset,
): Rectangle {
  const centerX = anchor.x + offset.x;
  const centerY = anchor.y + offset.y;
  return {
    top: centerY - anchor.height / 2 - COLLISION_PADDING,
    right: centerX + anchor.width / 2 + COLLISION_PADDING,
    bottom: centerY + anchor.height / 2 + COLLISION_PADDING,
    left: centerX - anchor.width / 2 - COLLISION_PADDING,
  };
}

function insideBounds(
  rectangle: Rectangle,
  bounds: { width: number; height: number },
): boolean {
  return (
    rectangle.top >= LABEL_MARGIN &&
    rectangle.left >= LABEL_MARGIN &&
    rectangle.right <= bounds.width - LABEL_MARGIN &&
    rectangle.bottom <= bounds.height - LABEL_MARGIN
  );
}

function overlaps(left: Rectangle, right: Rectangle): boolean {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}
