// Reconstruction d'une scène 3D commune aux deux personnes à partir d'une seule caméra.
//
// MediaPipe fournit, par personne, des coordonnées « world » en mètres centrées sur le
// milieu des hanches, axes alignés sur la caméra. La position relative des deux personnes
// est perdue : on la restitue par un modèle sténopé (pinhole) :
//   échelle s (px/m) = longueurs projetées en pixels / longueurs world projetées (x, y)
//   profondeur Z = f / s, avec f déduit du champ de vision horizontal supposé.
// Ensuite on estime le plan du sol (appuis des pieds) pour orienter la scène (Y vertical).

import { LM, N_LANDMARKS, FOOT_POINTS } from './skeleton.js';
import { fillGaps, gaussianSmooth } from './filters.js';

const SCALE_SEGMENTS = [
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.R_HIP, LM.R_KNEE],
  [LM.L_KNEE, LM.L_ANKLE], [LM.R_KNEE, LM.R_ANKLE],
  [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.R_SHOULDER, LM.R_ELBOW],
];

// ---------- petite algèbre 3D ----------
export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => Math.hypot(a[0], a[1], a[2]),
  unit: (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; },
};

// Vecteurs propres d'une matrice symétrique 3x3 (Jacobi). Renvoie {values, vectors (colonnes)}.
function eigSym3(m) {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-12) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: [0, 1, 2].map((j) => [v[0][j], v[1][j], v[2][j]]) };
}

function fitPlane(points) {
  const n = points.length;
  const c = [0, 0, 0];
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = v3.sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += d[i] * d[j];
  }
  const { values, vectors } = eigSym3(m);
  let k = 0;
  if (values[1] < values[k]) k = 1;
  if (values[2] < values[k]) k = 2;
  return { normal: v3.unit(vectors[k]), centroid: c };
}

function median(arr) {
  const s = Float64Array.from(arr).sort();
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

// Estimation de l'échelle px/m et de la racine (milieu des hanches) en coordonnées caméra.
function estimateRoot(person, f, cx, cy) {
  const { img, world } = person;
  let sp = 0, sw = 0;
  for (const [a, b] of SCALE_SEGMENTS) {
    const va = img[a * 3 + 2], vb = img[b * 3 + 2];
    if (va < 0.5 || vb < 0.5) continue;
    const lp = Math.hypot(img[a * 3] - img[b * 3], img[a * 3 + 1] - img[b * 3 + 1]);
    const lw = Math.hypot(world[a * 3] - world[b * 3], world[a * 3 + 1] - world[b * 3 + 1]);
    if (lw < 0.05) continue;
    const w = Math.min(va, vb);
    sp += w * lp; sw += w * lw;
  }
  if (sw < 0.15) return null;
  const s = sp / sw;
  const Z = f / s;
  const u = (img[LM.L_HIP * 3] + img[LM.R_HIP * 3]) / 2;
  const v = (img[LM.L_HIP * 3 + 1] + img[LM.R_HIP * 3 + 1]) / 2;
  // Le point world (0,0,0) est le milieu des hanches : on le rétro-projette à la profondeur Z.
  return [(u - cx) * Z / f, (v - cy) * Z / f, Z];
}

function smoothChannel(values, valid, maxGap, sigma, weights) {
  const s = values.map((x, i) => (valid[i] ? x : NaN));
  return gaussianSmooth(fillGaps(s, maxGap), sigma, weights);
}

/**
 * @param assigned [[A|null, B|null], …] (détections {img, world})
 * @param opts {width, height, fps, hfov (deg), sigma (images), maxGap (images), ground: 'auto'|'camera'}
 */
export function reconstruct(assigned, opts) {
  const { width, height, hfov = 66, sigma = 1.5, maxGap = 6, ground = 'auto' } = opts;
  const nF = assigned.length;
  const f = (width / 2) / Math.tan((hfov * Math.PI / 180) / 2);
  const cx = width / 2, cy = height / 2;

  const people = [0, 1].map((k) => {
    const valid = new Uint8Array(nF);
    const roots = [[], [], []];
    const local = Array.from({ length: N_LANDMARKS * 3 }, () => new Float64Array(nF).fill(NaN));
    const img = Array.from({ length: N_LANDMARKS * 3 }, () => new Float64Array(nF).fill(NaN));
    for (let i = 0; i < nF; i++) {
      const p = assigned[i][k];
      const root = p ? estimateRoot(p, f, cx, cy) : null;
      if (!root) { roots.forEach((r) => r.push(NaN)); continue; }
      valid[i] = 1;
      roots.forEach((r, d) => r.push(root[d]));
      for (let j = 0; j < N_LANDMARKS * 3; j++) { local[j][i] = p.world[j]; img[j][i] = p.img[j]; }
    }
    return { valid, roots, local, img };
  });

  // Lissage temporel. La profondeur (échelle) est la grandeur la plus bruitée : lissage renforcé.
  const recon = people.map(({ valid, roots, local, img }) => {
    const root = roots.map((r, d) => smoothChannel(r, valid, maxGap, d === 2 ? sigma * 3 : sigma * 1.5));
    const loc = local.map((ch) => smoothChannel(Array.from(ch), valid, maxGap, sigma));
    const im = img.map((ch, j) => (j % 3 === 2
      ? fillGaps(ch, maxGap)
      : smoothChannel(Array.from(ch), valid, maxGap, sigma)));
    return { root, loc, im };
  });

  // Positions en coordonnées caméra (x droite, y bas, z avant).
  const camPts = recon.map(({ root, loc }) => {
    const out = new Array(nF).fill(null);
    for (let i = 0; i < nF; i++) {
      if (Number.isNaN(root[0][i]) || Number.isNaN(loc[0][i])) continue;
      const P = new Float64Array(N_LANDMARKS * 3);
      for (let j = 0; j < N_LANDMARKS; j++) {
        P[j * 3] = root[0][i] + loc[j * 3][i];
        P[j * 3 + 1] = root[1][i] + loc[j * 3 + 1][i];
        P[j * 3 + 2] = root[2][i] + loc[j * 3 + 2][i];
      }
      out[i] = P;
    }
    return out;
  });

  // ---------- plan du sol ----------
  const camUp = [0, -1, 0];
  const footLows = [];
  const rootsAll = [];
  for (const pts of camPts) {
    for (const P of pts) {
      if (!P) continue;
      rootsAll.push([(P[LM.L_HIP * 3] + P[LM.R_HIP * 3]) / 2, (P[LM.L_HIP * 3 + 1] + P[LM.R_HIP * 3 + 1]) / 2, (P[LM.L_HIP * 3 + 2] + P[LM.R_HIP * 3 + 2]) / 2]);
      // point le plus bas de chaque pied (le long de la verticale caméra)
      for (const side of ['L', 'R']) {
        let best = null, bestH = Infinity;
        for (const j of FOOT_POINTS[side]) {
          const q = [P[j * 3], P[j * 3 + 1], P[j * 3 + 2]];
          const h = v3.dot(q, camUp);
          if (h < bestH) { bestH = h; best = q; }
        }
        footLows.push(best);
      }
    }
  }

  let up = camUp;
  let groundInfo = 'verticale caméra (téléphone supposé horizontal)';
  if (ground === 'auto' && footLows.length >= 30) {
    // On ne garde que le quart inférieur des pieds par hauteur (pieds en appui probables),
    // puis ajustement de plan avec rejet itératif des points aberrants.
    let pts = footLows.slice().sort((a, b) => v3.dot(a, camUp) - v3.dot(b, camUp));
    pts = pts.slice(0, Math.max(20, Math.floor(pts.length * 0.5)));
    let plane = fitPlane(pts);
    for (let it = 0; it < 3; it++) {
      const res = pts.map((p) => Math.abs(v3.dot(v3.sub(p, plane.centroid), plane.normal)));
      const thr = 2.5 * median(res) + 1e-3;
      const kept = pts.filter((_, i) => res[i] <= thr);
      if (kept.length < 15) break;
      pts = kept;
      plane = fitPlane(pts);
    }
    let n = plane.normal;
    if (v3.dot(n, camUp) < 0) n = v3.scale(n, -1);
    const tilt = Math.acos(Math.min(1, v3.dot(n, camUp))) * 180 / Math.PI;
    if (tilt < 35) {
      up = n;
      groundInfo = `plan ajusté sur les appuis (inclinaison caméra estimée ${tilt.toFixed(1)}°)`;
    } else {
      groundInfo = `ajustement du sol rejeté (${tilt.toFixed(0)}°), verticale caméra utilisée`;
    }
  }

  // Hauteur du sol : 5e centile des pieds le long de « up ».
  const heights = footLows.map((p) => v3.dot(p, up)).sort((a, b) => a - b);
  const groundH = heights.length ? heights[Math.floor(heights.length * 0.05)] : 0;

  // Repère scène : Y = up, Z = direction horizontale vers la caméra, X = Y × Z ; origine au sol
  // sous le barycentre des hanches.
  const center = rootsAll.length
    ? v3.scale(rootsAll.reduce((a, b) => v3.add(a, b), [0, 0, 0]), 1 / rootsAll.length)
    : [0, 0, 3];
  const toCam = v3.scale(center, -1);
  let Zs = v3.sub(toCam, v3.scale(up, v3.dot(toCam, up)));
  Zs = v3.unit(Zs);
  const Ys = up;
  const Xs = v3.cross(Ys, Zs);
  const origin = v3.add(center, v3.scale(up, groundH - v3.dot(center, up)));
  const toScene = (q) => { const d = v3.sub(q, origin); return [v3.dot(d, Xs), v3.dot(d, Ys), v3.dot(d, Zs)]; };
  const dirToScene = (d) => [v3.dot(d, Xs), v3.dot(d, Ys), v3.dot(d, Zs)];

  const frames = [];
  for (let i = 0; i < nF; i++) {
    const persons = [0, 1].map((k) => {
      const P = camPts[k][i];
      if (!P) return null;
      const joints = new Float32Array(N_LANDMARKS * 3);
      const img2d = new Float32Array(N_LANDMARKS * 3);
      for (let j = 0; j < N_LANDMARKS; j++) {
        const s = toScene([P[j * 3], P[j * 3 + 1], P[j * 3 + 2]]);
        joints.set(s, j * 3);
        img2d[j * 3] = recon[k].im[j * 3][i];
        img2d[j * 3 + 1] = recon[k].im[j * 3 + 1][i];
        const vis = recon[k].im[j * 3 + 2][i];
        img2d[j * 3 + 2] = Number.isNaN(vis) ? 0 : vis;
      }
      return { joints, img: img2d, detected: !!assigned[i][k] };
    });
    frames.push(persons);
  }

  return {
    frames,
    camera: { position: toScene([0, 0, 0]), forward: dirToScene([0, 0, 1]), up: dirToScene([0, -1, 0]), hfov, width, height },
    groundInfo,
  };
}
