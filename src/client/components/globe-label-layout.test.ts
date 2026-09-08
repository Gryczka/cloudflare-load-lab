import { describe, expect, it } from "vitest";
import {
  layoutMarkerLabels,
  type MarkerLabelAnchor,
} from "./globe-label-layout";

function rectanglesOverlap(
  left: MarkerLabelAnchor,
  leftOffset: { x: number; y: number },
  right: MarkerLabelAnchor,
  rightOffset: { x: number; y: number },
): boolean {
  return !(
    left.x + leftOffset.x + left.width / 2 <=
      right.x + rightOffset.x - right.width / 2 ||
    left.x + leftOffset.x - left.width / 2 >=
      right.x + rightOffset.x + right.width / 2 ||
    left.y + leftOffset.y + left.height / 2 <=
      right.y + rightOffset.y - right.height / 2 ||
    left.y + leftOffset.y - left.height / 2 >=
      right.y + rightOffset.y + right.height / 2
  );
}

describe("layoutMarkerLabels", () => {
  it("moves labels into separate lanes when placement nodes cluster", () => {
    const left = { id: "LAX", x: 100, y: 40, width: 52, height: 12 };
    const right = { id: "ATL", x: 112, y: 40, width: 52, height: 12 };
    const offsets = layoutMarkerLabels([left, right], {
      width: 240,
      height: 140,
    });
    const leftOffset = offsets.get(left.id);
    const rightOffset = offsets.get(right.id);

    expect(leftOffset).toBeDefined();
    expect(rightOffset).toBeDefined();
    expect(rectanglesOverlap(left, leftOffset!, right, rightOffset!)).toBe(
      false,
    );
  });

  it("keeps labels inside the map edge", () => {
    const marker = { id: "edge", x: 8, y: 8, width: 48, height: 12 };
    const offset = layoutMarkerLabels([marker], {
      width: 240,
      height: 140,
    }).get(marker.id);

    expect(offset?.x).toBeGreaterThan(0);
    expect(offset?.y).toBeGreaterThan(0);
  });
});
