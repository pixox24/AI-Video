export const TOOL_RAIL_MIN = 360;
export const TOOL_RAIL_MAX = 520;
export const TOOL_RAIL_DEFAULT = 416;

const STORAGE_KEY = 'ai_video_tool_rail_width';

export function clampToolRailWidth(value: number): number {
  if (!Number.isFinite(value)) return TOOL_RAIL_DEFAULT;
  return Math.round(Math.max(TOOL_RAIL_MIN, Math.min(TOOL_RAIL_MAX, value)));
}

export function loadToolRailWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return TOOL_RAIL_DEFAULT;
    return clampToolRailWidth(Number(raw));
  } catch {
    return TOOL_RAIL_DEFAULT;
  }
}

export function persistToolRailWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampToolRailWidth(width)));
  } catch {
    // ignore quota
  }
}
