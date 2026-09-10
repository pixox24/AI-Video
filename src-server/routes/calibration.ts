import type { Express } from 'express';
import { calibrationInputSchema } from '../../src/shared/calibration';
import { recordCalibration } from '../duration/calibration';

export function registerCalibrationRoutes(app: Express, filename?: string): void {
  app.post('/api/script/calibration', (req, res) => {
    const input = calibrationInputSchema.safeParse(req.body as unknown);
    if (!input.success) { res.status(400).json({ error: 'Invalid calibration input', issues: input.error.issues }); return; }
    try { res.json(recordCalibration(input.data, filename)); }
    catch { res.status(503).json({ error: 'Calibration unavailable; audio is unchanged' }); }
  });
}
