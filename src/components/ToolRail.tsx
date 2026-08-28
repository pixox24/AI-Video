import React, { useCallback, useEffect, useState } from 'react';
import {
  clampToolRailWidth,
  loadToolRailWidth,
  persistToolRailWidth,
  TOOL_RAIL_MAX,
  TOOL_RAIL_MIN
} from '../utils/toolRail';

let currentWidth = loadToolRailWidth();
const listeners = new Set<(width: number) => void>();

function setSharedWidth(next: number) {
  currentWidth = clampToolRailWidth(next);
  persistToolRailWidth(currentWidth);
  listeners.forEach((listener) => listener(currentWidth));
}

function useToolRailWidth() {
  const [width, setWidth] = useState(currentWidth);
  useEffect(() => {
    listeners.add(setWidth);
    setWidth(currentWidth);
    return () => {
      listeners.delete(setWidth);
    };
  }, []);
  return width;
}

export const ToolRail: React.FC<{
  id?: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const width = useToolRailWidth();

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = currentWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setSharedWidth(startWidth + (moveEvent.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  return (
    <div
      id={id}
      style={{ width }}
      className="tool-rail relative flex-shrink-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden select-none z-20 shadow-xl shadow-black/40"
    >
      {children}
      <button
        type="button"
        aria-label="拖拽调整工具栏宽度"
        title={`栏宽 ${width}px（${TOOL_RAIL_MIN}–${TOOL_RAIL_MAX}）`}
        onPointerDown={onPointerDown}
        className="absolute top-0 right-0 z-40 h-full w-1.5 cursor-ew-resize border-0 bg-transparent hover:bg-amber-500/35 active:bg-amber-500/50"
      />
    </div>
  );
};
