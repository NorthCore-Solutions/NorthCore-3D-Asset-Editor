const EPSILON = 0.000001;

export function snapScaleValueToWorldStep(
  rawScale: number,
  localSize: number,
  worldStep: number,
  minimumScale: number = 0.02
): number {
  const size = Math.abs(localSize);
  if (!Number.isFinite(rawScale) || !Number.isFinite(size) || !Number.isFinite(worldStep) || size <= EPSILON || worldStep <= EPSILON) {
    return Math.max(minimumScale, rawScale);
  }

  const rawWorldSize = size * rawScale;
  const snappedWorldSize = Math.round(rawWorldSize / worldStep) * worldStep;
  return Math.max(minimumScale, snappedWorldSize / size);
}

export function snapUniformScaleFactorToWorldStep(
  rawFactor: number,
  baseWorldSizes: readonly number[],
  worldStep: number,
  minimumFactor: number = 0.02
): number {
  const referenceSize = baseWorldSizes.reduce((largest, value) => (
    Number.isFinite(value) ? Math.max(largest, Math.abs(value)) : largest
  ), 0);

  if (!Number.isFinite(rawFactor) || !Number.isFinite(worldStep) || referenceSize <= EPSILON || worldStep <= EPSILON) {
    return Math.max(minimumFactor, rawFactor);
  }

  const snappedWorldSize = Math.round((referenceSize * rawFactor) / worldStep) * worldStep;
  return Math.max(minimumFactor, snappedWorldSize / referenceSize);
}
