export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSnapResult {
  x: number;
  y: number;
  guideX?: number;
  guideY?: number;
}

export type HorizontalResizeEdge = 'left' | 'right';

export interface HorizontalResizeStart {
  pointerX: number;
  x: number;
  width: number;
  edge: HorizontalResizeEdge;
}

type AxisCandidate = {
  value: number;
  guide: number;
};

const getNearestCandidate = (value: number, candidates: AxisCandidate[], threshold: number) => {
  let nearest: AxisCandidate | undefined;
  let nearestDistance = threshold + 1;

  for (const candidate of candidates) {
    const distance = Math.abs(value - candidate.value);
    if (distance <= threshold && distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
};

export const snapWindowRect = (
  moving: WindowRect,
  targets: WindowRect[],
  bounds: WindowRect[],
  threshold = 12,
  gap = 8
): WindowSnapResult => {
  const xCandidates: AxisCandidate[] = [];
  const yCandidates: AxisCandidate[] = [];

  for (const area of bounds) {
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    xCandidates.push(
      { value: area.x + gap, guide: area.x + gap },
      { value: right - gap - moving.width, guide: right - gap }
    );
    yCandidates.push(
      { value: area.y + gap, guide: area.y + gap },
      { value: bottom - gap - moving.height, guide: bottom - gap }
    );
  }

  for (const target of targets) {
    const targetRight = target.x + target.width;
    const targetBottom = target.y + target.height;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;

    xCandidates.push(
      { value: target.x, guide: target.x },
      { value: targetRight - moving.width, guide: targetRight },
      { value: targetRight + gap, guide: targetRight + gap },
      { value: target.x - moving.width - gap, guide: target.x - gap },
      { value: targetCenterX - moving.width / 2, guide: targetCenterX }
    );
    yCandidates.push(
      { value: target.y, guide: target.y },
      { value: targetBottom - moving.height, guide: targetBottom },
      { value: targetBottom + gap, guide: targetBottom + gap },
      { value: target.y - moving.height - gap, guide: target.y - gap },
      { value: targetCenterY - moving.height / 2, guide: targetCenterY }
    );
  }

  const snappedX = getNearestCandidate(moving.x, xCandidates, threshold);
  const snappedY = getNearestCandidate(moving.y, yCandidates, threshold);

  return {
    x: snappedX?.value ?? moving.x,
    y: snappedY?.value ?? moving.y,
    guideX: snappedX?.guide,
    guideY: snappedY?.guide
  };
};

export const resizeWindowHorizontally = (
  start: HorizontalResizeStart,
  pointerX: number,
  minWidth = 100
) => {
  const delta = pointerX - start.pointerX;
  const requestedWidth = start.edge === 'left'
    ? start.width - delta
    : start.width + delta;
  const width = Math.max(minWidth, requestedWidth);

  return {
    x: start.edge === 'left' ? start.x + start.width - width : start.x,
    width
  };
};
