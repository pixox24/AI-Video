import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { VideoProject } from '../types';
import { calibrationInputSchema, calibrationResultSchema } from '../shared/calibration';
import { applyCalibrationResult, calibrationInputForProject } from '../utils/durationCalibration';

export function useDurationCalibration(project: VideoProject, setProject: Dispatch<SetStateAction<VideoProject>>): void {
  const inputKey = JSON.stringify(calibrationInputForProject(project));
  const latest = useRef(inputKey); latest.current = inputKey;
  useEffect(() => {
    let cancelled = false;
    setProject(current => applyCalibrationResult(current));
    if (!inputKey) return;
    const timer = window.setTimeout(() => {
      const input = calibrationInputSchema.safeParse(JSON.parse(inputKey));
      if (!input.success) return;
      void fetch('/api/script/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.data) })
        .then(async response => { if (!response.ok) throw new Error('calibration unavailable'); return calibrationResultSchema.parse(await response.json()); })
        .then(result => { if (!cancelled && latest.current === inputKey) setProject(current =>
          JSON.stringify(calibrationInputForProject(current)) === inputKey ? applyCalibrationResult(current, result) : current); })
        .catch(() => { /* Optional telemetry failure must never interrupt audio synthesis or editing. */ });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [inputKey, setProject]);
}
