import {
  CameraAngle,
  CameraMotion,
  CoverageJob,
  CoverageLink,
  CoverageSource,
  ForecastShot,
  ShotComposition,
  ShotSize,
  VisualBible,
  VisualBibleMode
} from '../types';

const SIZES: ShotSize[] = ['ecu', 'cu', 'ms', 'ws', 'insert'];
const ANGLES: CameraAngle[] = ['eye', 'low', 'high'];
const COMPS: ShotComposition[] = ['center', 'thirds', 'silhouette', 'negative-left', 'negative-right'];
const JOBS: CoverageJob[] = ['hook', 'establish', 'evidence', 'insert', 'contrast', 'callback'];
const LINKS: CoverageLink[] = ['advance', 'contrast-cut', 'callback', 'same-axis'];

export const SHOT_SIZE_LABEL: Record<ShotSize, string> = {
  ecu: '大特写',
  cu: '特写',
  ms: '中景',
  ws: '全景',
  insert: '插入'
};

export const CAMERA_ANGLE_LABEL: Record<CameraAngle, string> = {
  eye: '平视',
  low: '微仰',
  high: '俯拍'
};

export const COMPOSITION_LABEL: Record<ShotComposition, string> = {
  center: '居中',
  thirds: '三分',
  silhouette: '轮廓',
  'negative-left': '左留白',
  'negative-right': '右留白'
};

export const COVERAGE_JOB_LABEL: Record<CoverageJob, string> = {
  hook: '钩子',
  establish: '建立',
  evidence: '证据',
  insert: '机制',
  contrast: '对照',
  callback: '回收'
};

function asEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function isContrastShot(shot: ForecastShot): boolean {
  if (shot.voRole === 'continue') return true;
  if (shot.continuity === 'contrast') return true;
  return (shot.splitReason || '').includes('对照');
}

const ALT: ShotSize[] = ['cu', 'ms', 'insert', 'ecu', 'ws'];

function differentSize(prev: ShotSize | undefined, preferred: ShotSize): ShotSize {
  if (!prev || prev !== preferred) return preferred;
  return ALT.find((item) => item !== prev) || 'ms';
}

export function assignRuleCoverage(
  shots: ForecastShot[],
  mode: VisualBibleMode = 'expository'
): ForecastShot[] {
  if (shots.length === 0) return shots;
  const next: ForecastShot[] = [];
  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index];
    const prev = next[index - 1];
    const first = index === 0;
    const last = index === shots.length - 1;
    const contrast = isContrastShot(shot);
    const firstSize: ShotSize = mode === 'story' ? 'cu' : 'ecu';

    let shotSize: ShotSize = 'ms';
    let cameraAngle: CameraAngle = 'eye';
    let shotComposition: ShotComposition = 'thirds';
    let coverageJob: CoverageJob = 'evidence';
    let coverageLink: CoverageLink = 'advance';

    if (first) {
      shotSize = firstSize;
      coverageJob = 'hook';
      coverageLink = 'advance';
    } else if (last) {
      shotSize = differentSize(prev?.shotSize, firstSize === 'ecu' ? 'cu' : firstSize);
      coverageJob = 'callback';
      shotComposition = next[0]?.shotComposition || 'thirds';
      coverageLink = 'callback';
    } else if (contrast) {
      shotSize = differentSize(prev?.shotSize, prev?.shotSize === 'ms' ? 'cu' : 'ms');
      coverageJob = 'contrast';
      coverageLink = 'contrast-cut';
      shotComposition = prev?.shotComposition === 'negative-left' ? 'negative-right' : 'negative-left';
    } else if (index === 1) {
      shotSize = differentSize(prev?.shotSize, mode === 'story' ? 'ms' : 'insert');
      coverageJob = mode === 'story' ? 'establish' : 'insert';
      coverageLink = 'same-axis';
    } else if (shot.function === 'proof' || shot.function === 'reveal') {
      shotSize = differentSize(prev?.shotSize, index % 2 === 0 ? 'insert' : 'cu');
      coverageJob = shotSize === 'insert' ? 'insert' : 'evidence';
    } else {
      shotSize = differentSize(prev?.shotSize, index % 2 === 0 ? 'cu' : 'ms');
    }

    next.push({
      ...shot,
      shotSize,
      cameraAngle,
      shotComposition,
      coverageJob,
      coverageLink,
      coverageSource: 'rule'
    });
  }
  return next;
}

function slotKey(shot: Pick<ForecastShot, 'spanId' | 'visualIndex' | 'id'>): string {
  if (shot.spanId) return `${shot.spanId}#${shot.visualIndex ?? 0}`;
  return shot.id;
}

export function mergeCoverage(
  next: ForecastShot[],
  previous: ForecastShot[]
): ForecastShot[] {
  if (previous.length === 0) return next;
  const prevBySlot = new Map(previous.map((shot) => [slotKey(shot), shot]));
  return next.map((shot, index) => {
    const prev = prevBySlot.get(slotKey(shot)) || previous[index];
    if (!prev) return shot;
    if (prev.coverageSource === 'pinned' || prev.coverageSource === 'llm') {
      return {
        ...shot,
        shotSize: prev.shotSize || shot.shotSize,
        cameraAngle: prev.cameraAngle || shot.cameraAngle,
        shotComposition: prev.shotComposition || shot.shotComposition,
        coverageJob: prev.coverageJob || shot.coverageJob,
        coverageLink: prev.coverageLink || shot.coverageLink,
        coverageSource: prev.coverageSource
      };
    }
    return shot;
  });
}

export function applyLlmCoverage(
  shots: ForecastShot[],
  incoming: Array<{
    id?: string;
    shotSize?: string;
    cameraAngle?: string;
    shotComposition?: string;
    coverageJob?: string;
    coverageLink?: string;
  }>
): ForecastShot[] {
  if (!Array.isArray(incoming) || incoming.length === 0) return shots;
  const byId = new Map(incoming.map((item) => [String(item.id || ''), item]));
  const stamped = shots.map((shot, index) => {
    const hit = byId.get(shot.id) || incoming[index];
    if (!hit) return shot;
    return {
      ...shot,
      shotSize: asEnum(hit.shotSize, SIZES, shot.shotSize || 'ms'),
      cameraAngle: asEnum(hit.cameraAngle, ANGLES, shot.cameraAngle || 'eye'),
      shotComposition: asEnum(hit.shotComposition, COMPS, shot.shotComposition || 'thirds'),
      coverageJob: asEnum(hit.coverageJob, JOBS, shot.coverageJob || 'evidence'),
      coverageLink: asEnum(hit.coverageLink, LINKS, shot.coverageLink || 'advance'),
      coverageSource: 'llm' as CoverageSource
    };
  });
  return stamped.map((shot, index, list) => {
    if (index === 0) return shot;
    const prev = list[index - 1];
    if (shot.shotSize !== prev.shotSize) return shot;
    return { ...shot, shotSize: differentSize(prev.shotSize, shot.shotSize || 'ms') };
  });
}

export function cameraMotionForCoverage(shot: {
  shotSize?: ShotSize;
  coverageJob?: CoverageJob;
  energy?: string;
}): CameraMotion {
  const size = shot.shotSize;
  if (shot.coverageJob === 'callback' || size === 'ecu' || size === 'cu' || size === 'insert') {
    return 'static';
  }
  if (size === 'ws' && shot.coverageJob === 'establish') return 'zoom-out';
  if (size === 'ws') return 'zoom-in';
  return 'zoom-in';
}

export function coverageFramingLine(shot: {
  shotSize?: ShotSize;
  cameraAngle?: CameraAngle;
  shotComposition?: ShotComposition;
  coverageJob?: CoverageJob;
}): string {
  if (!shot.shotSize) return '';
  const parts = [
    SHOT_SIZE_LABEL[shot.shotSize],
    shot.cameraAngle ? CAMERA_ANGLE_LABEL[shot.cameraAngle] : '',
    shot.shotComposition ? COMPOSITION_LABEL[shot.shotComposition] : '',
    shot.coverageJob ? COVERAGE_JOB_LABEL[shot.coverageJob] : ''
  ].filter(Boolean);
  return parts.join('，');
}

export function coverageModeFromBible(bible?: VisualBible | null): VisualBibleMode {
  return bible?.mode === 'story' ? 'story' : 'expository';
}

export function withCoverage(
  shots: ForecastShot[],
  bible?: VisualBible | null,
  previous?: ForecastShot[]
): ForecastShot[] {
  const ruled = assignRuleCoverage(shots, coverageModeFromBible(bible));
  return mergeCoverage(ruled, previous || []);
}
