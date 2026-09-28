// Traitements temporels hors ligne (zéro déphasage) sur des séries pouvant contenir des NaN.

// Interpolation linéaire des trous de longueur <= maxGap ; les trous plus longs restent NaN.
export function fillGaps(series, maxGap) {
  const n = series.length;
  const out = Float64Array.from(series);
  let i = 0;
  while (i < n) {
    if (!Number.isNaN(out[i])) { i++; continue; }
    let j = i;
    while (j < n && Number.isNaN(out[j])) j++;
    const gap = j - i;
    if (i > 0 && j < n && gap <= maxGap) {
      const a = out[i - 1], b = out[j];
      for (let k = i; k < j; k++) out[k] = a + (b - a) * (k - i + 1) / (gap + 1);
    }
    i = j;
  }
  return out;
}

// Lissage gaussien normalisé : ignore les NaN, conserve NaN là où il n'y a pas de donnée.
export function gaussianSmooth(series, sigma, weights = null) {
  const n = series.length;
  if (!(sigma > 0)) return Float64Array.from(series);
  const r = Math.ceil(3 * sigma);
  const kernel = new Float64Array(2 * r + 1);
  for (let k = -r; k <= r; k++) kernel[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(series[i])) { out[i] = NaN; continue; }
    let s = 0, w = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const v = series[j];
      if (Number.isNaN(v)) continue;
      const wk = kernel[k + r] * (weights ? weights[j] : 1);
      s += wk * v; w += wk;
    }
    out[i] = w > 0 ? s / w : series[i];
  }
  return out;
}

// Dérivée centrée (unités / s).
export function derivative(series, dt) {
  const n = series.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? series[i - 1] : NaN;
    const b = i < n - 1 ? series[i + 1] : NaN;
    if (!Number.isNaN(a) && !Number.isNaN(b)) out[i] = (b - a) / (2 * dt);
    else if (!Number.isNaN(b) && !Number.isNaN(series[i])) out[i] = (b - series[i]) / dt;
    else if (!Number.isNaN(a) && !Number.isNaN(series[i])) out[i] = (series[i] - a) / dt;
  }
  return out;
}
