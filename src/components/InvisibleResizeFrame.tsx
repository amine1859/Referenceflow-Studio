import type { CSSProperties, MouseEvent } from 'react';
import type { WindowResizeEdge } from '../lib/windowGeometry';

type ResizeFrameKind = 'media' | 'note' | 'sketch' | 'pill';

type ResizeZone = {
  edge: WindowResizeEdge;
  cursorClass: string;
  title: string;
};

const RESIZE_ZONES: readonly ResizeZone[] = [
  { edge: 'top', cursorClass: 'cursor-ns-resize', title: 'Resize from top' },
  { edge: 'bottom', cursorClass: 'cursor-ns-resize', title: 'Resize from bottom' },
  { edge: 'left', cursorClass: 'cursor-ew-resize', title: 'Resize from left' },
  { edge: 'right', cursorClass: 'cursor-ew-resize', title: 'Resize from right' },
  { edge: 'top-left', cursorClass: 'cursor-nwse-resize', title: 'Resize from top left' },
  { edge: 'top-right', cursorClass: 'cursor-nesw-resize', title: 'Resize from top right' },
  { edge: 'bottom-left', cursorClass: 'cursor-nesw-resize', title: 'Resize from bottom left' },
  { edge: 'bottom-right', cursorClass: 'cursor-nwse-resize', title: 'Resize from bottom right' }
];

const getZoneStyle = (edge: WindowResizeEdge, toolbarHeight: number): CSSProperties => {
  if (edge === 'top') return { left: 16, right: 16, top: -toolbarHeight, height: 8 };
  if (edge === 'bottom') return { left: 16, right: 16, bottom: 0, height: 8 };
  if (edge === 'left') return { left: 0, top: -(toolbarHeight - 4), bottom: 16, width: 8 };
  if (edge === 'right') return { right: 0, top: -(toolbarHeight - 4), bottom: 16, width: 8 };
  if (edge === 'top-left') return { left: 0, top: -toolbarHeight, width: 16, height: 16 };
  if (edge === 'top-right') return { right: 0, top: -toolbarHeight, width: 16, height: 16 };
  if (edge === 'bottom-left') return { left: 0, bottom: 0, width: 16, height: 16 };
  return { right: 0, bottom: 0, width: 16, height: 16 };
};

export const getWindowResizeCursorClass = (edge: WindowResizeEdge) => {
  return RESIZE_ZONES.find(zone => zone.edge === edge)?.cursorClass || 'cursor-nwse-resize';
};

export function InvisibleResizeFrame({
  kind,
  toolbarHeight,
  onResizeMouseDown
}: {
  kind: ResizeFrameKind;
  toolbarHeight: number;
  onResizeMouseDown: (event: MouseEvent<HTMLDivElement>, edge: WindowResizeEdge) => void;
}) {
  return (
    <div
      className="absolute inset-0 z-[70] pointer-events-none no-window-drag"
      data-invisible-resize-frame={kind}
    >
      {RESIZE_ZONES.map(({ edge, cursorClass, title }) => (
        <div
          key={edge}
          className={`floating-resize-hit-zone absolute pointer-events-auto ${cursorClass}`}
          style={getZoneStyle(edge, toolbarHeight)}
          onMouseDown={(event) => onResizeMouseDown(event, edge)}
          title={title}
          data-resize-edge={edge}
          data-note-resize-handle={kind === 'note' && edge === 'bottom-right' ? 'true' : undefined}
          data-sketch-resize-handle={kind === 'sketch' && edge === 'bottom-right' ? 'true' : undefined}
        />
      ))}
    </div>
  );
}
