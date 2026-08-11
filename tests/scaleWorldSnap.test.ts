import { describe, expect, it } from 'vitest';
import {
  snapScaleValueToWorldStep,
  snapUniformScaleFactorToWorldStep
} from '../src/editor/snapping/scaleWorldSnap';

describe('Skalierungs-Snapping auf Weltmaß', () => {
  it('snappt eine 0,5-Welteinheiten breite Achse in 0,25er-Schritten statt in Skalierungsfaktoren', () => {
    const scale = snapScaleValueToWorldStep(1.3, 0.5, 0.25);
    expect(scale).toBe(1.5);
    expect(0.5 * scale).toBe(0.75);
  });

  it('snappt eine 1,0-Welteinheiten breite Achse ebenfalls auf 0,25', () => {
    const scale = snapScaleValueToWorldStep(1.13, 1, 0.25);
    expect(scale).toBe(1.25);
  });

  it('verwendet bei proportionaler Skalierung die größte Ausgangsausdehnung als Referenz', () => {
    const factor = snapUniformScaleFactorToWorldStep(1.18, [0.5, 1, 0.75], 0.25);
    expect(factor).toBe(1.25);
  });

  it('unterschreitet die minimale Skalierung nicht', () => {
    expect(snapScaleValueToWorldStep(0.01, 1, 0.25)).toBe(0.02);
    expect(snapUniformScaleFactorToWorldStep(0.01, [1, 1, 1], 0.25)).toBe(0.02);
  });
});
