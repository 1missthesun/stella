export const resampleLinear = (
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array => {
  if (sourceRate === targetRate) return samples;

  const ratio = sourceRate / targetRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const resampled = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = i * ratio;
    const sourceFloor = Math.floor(sourceIndex);
    const sourceCeil = Math.min(sourceFloor + 1, samples.length - 1);
    const alpha = sourceIndex - sourceFloor;
    const a = samples[sourceFloor]!;
    const b = samples[sourceCeil]!;
    resampled[i] = a + (b - a) * alpha;
  }

  return resampled;
};

export const floatToPcm16Le = (samples: Float32Array): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    const sample =
      clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(i * 2, sample, true);
  }
  return bytes;
};
