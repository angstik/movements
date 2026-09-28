// Indicateurs mécaniques calculés sur la scène reconstruite (repère : Y vertical, sol Y = 0).

import { LM, FOOT_POINTS } from './skeleton.js';
import { v3 } from './reconstruct.js';
import { derivative, gaussianSmooth } from './filters.js';

const G = 9.81;

// Modèle segmentaire : de Leva (1996), valeurs masculines (masse en % du corps, CoM en % depuis le point proximal).
// Les points MediaPipe ne sont pas des repères anatomiques : il s'agit d'une approximation.
const mid = (a, b) => ({ mid: [a, b] });
const SEGMENTS = [
  { name: 'tête', prox: mid(LM.L_EAR, LM.R_EAR), dist: mid(LM.L_EAR, LM.R_EAR), mass: 6.94, com: 0 },
  { name: 'tronc', prox: mid(LM.L_SHOULDER, LM.R_SHOULDER), dist: mid(LM.L_HIP, LM.R_HIP), mass: 43.46, com: 44.86 },
  { name: 'bras G', prox: LM.L_SHOULDER, dist: LM.L_ELBOW, mass: 2.71, com: 57.72 },
  { name: 'bras D', prox: LM.R_SHOULDER, dist: LM.R_ELBOW, mass: 2.71, com: 57.72 },
  { name: 'avant-bras G', prox: LM.L_ELBOW, dist: LM.L_WRIST, mass: 1.62, com: 45.74 },
  { name: 'avant-bras D', prox: LM.R_ELBOW, dist: LM.R_WRIST, mass: 1.62, com: 45.74 },
  { name: 'main G', prox: LM.L_WRIST, dist: mid(LM.L_INDEX, LM.L_PINKY), mass: 0.61, com: 79.0 },
  { name: 'main D', prox: LM.R_WRIST, dist: mid(LM.R_INDEX, LM.R_PINKY), mass: 0.61, com: 79.0 },
  { name: 'cuisse G', prox: LM.L_HIP, dist: LM.L_KNEE, mass: 14.16, com: 40.95 },
  { name: 'cuisse D', prox: LM.R_HIP, dist: LM.R_KNEE, mass: 14.16, com: 40.95 },
  { name: 'jambe G', prox: LM.L_KNEE, dist: LM.L_ANKLE, mass: 4.33, com: 44.59 },
  { name: 'jambe D', prox: LM.R_KNEE, dist: LM.R_ANKLE, mass: 4.33, com: 44.59 },
  { name: 'pied G', prox: LM.L_HEEL, dist: LM.L_FOOT, mass: 1.37, com: 44.15 },
  { name: 'pied D', prox: LM.R_HEEL, dist: LM.R_FOOT, mass: 1.37, com: 44.15 },
];

function point(P, ref, dim) {
  if (typeof ref === 'number') return Array.from({ length: dim }, (_, d) => P[ref * 3 + d]);
  const [a, b] = ref.mid;
  return Array.from({ length: dim }, (_, d) => (P[a * 3 + d] + P[b * 3 + d]) / 2);
}

// Centre de masse ; dim = 3 (scène) ou 2 (image).
export function centerOfMass(P, dim = 3) {
  const c = new Array(dim).fill(0);
  let m = 0;
  for (const s of SEGMENTS) {
    const a = point(P, s.prox, dim), b = point(P, s.dist, dim);
    for (let d = 0; d < dim; d++) c[d] += s.mass * (a[d] + (b[d] - a[d]) * s.com / 100);
    m += s.mass;
  }
  return c.map((x) => x / m);
}

const J = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

function angleAt(a, b, c) {
  const u = v3.sub(a, b), w = v3.sub(c, b);
  const cos = v3.dot(u, w) / ((v3.norm(u) * v3.norm(w)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

function angleBetween(u, w) {
  const cos = v3.dot(u, w) / ((v3.norm(u) * v3.norm(w)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

// Enveloppe convexe 2D (chaîne monotone d'Andrew), points [x, z].
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

// Distance signée d'un point au polygone d'appui : > 0 à l'intérieur, < 0 à l'extérieur.
export function signedMargin(p, hull) {
  if (!hull.length) return NaN;
  let d = Infinity;
  for (let i = 0; i < hull.length; i++) {
    d = Math.min(d, segDist(p, hull[i], hull[(i + 1) % hull.length]));
  }
  if (hull.length < 3) return -d;
  let inside = true;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) { inside = false; break; }
  }
  return inside ? d : -d;
}

// Polygone de sustentation à partir des points de pied proches du sol.
function baseOfSupport(P, tol) {
  let minY = Infinity;
  for (const side of ['L', 'R']) for (const j of FOOT_POINTS[side]) minY = Math.min(minY, P[j * 3 + 1]);
  if (minY > 0.25) return { hull: [], contacts: { L: false, R: false } }; // plus d'appui plausible (chute, ukemi)
  const pts = [];
  const contacts = { L: false, R: false };
  for (const side of ['L', 'R']) {
    const ys = FOOT_POINTS[side].map((j) => P[j * 3 + 1]);
    if (Math.min(...ys) <= minY + tol) {
      contacts[side] = true;
      for (const j of FOOT_POINTS[side]) pts.push([P[j * 3], P[j * 3 + 2]]);
    }
  }
  return { hull: convexHull(pts), contacts };
}

// Direction du regard du bassin dans le plan horizontal (x, z).
function pelvisHeading(P) {
  const r = v3.sub(J(P, LM.L_HIP), J(P, LM.R_HIP));
  const f = v3.cross(r, [0, 1, 0]);
  const n = Math.hypot(f[0], f[2]) || 1;
  return [f[0] / n, f[2] / n];
}

function signedAngle2(a, b) {
  return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180 / Math.PI;
}

// Catalogue des indicateurs (pour graphiques et export).
export const METRICS = [
  { key: 'comY', label: 'Hauteur du CoM', unit: 'm', group: 'Équilibre' },
  { key: 'comSpeed', label: 'Vitesse horizontale du CoM', unit: 'm/s', group: 'Équilibre' },
  { key: 'margin', label: 'Marge statique CoM / polygone d’appui', unit: 'm', group: 'Équilibre' },
  { key: 'marginXcom', label: 'Marge dynamique XCoM (Hof)', unit: 'm', group: 'Équilibre' },
  { key: 'trunkTilt', label: 'Inclinaison du tronc / verticale', unit: '°', group: 'Posture' },
  { key: 'kneeL', label: 'Flexion genou G', unit: '°', group: 'Articulations' },
  { key: 'kneeR', label: 'Flexion genou D', unit: '°', group: 'Articulations' },
  { key: 'hipL', label: 'Flexion hanche G', unit: '°', group: 'Articulations' },
  { key: 'hipR', label: 'Flexion hanche D', unit: '°', group: 'Articulations' },
  { key: 'elbowL', label: 'Flexion coude G', unit: '°', group: 'Articulations' },
  { key: 'elbowR', label: 'Flexion coude D', unit: '°', group: 'Articulations' },
  { key: 'shoulderL', label: 'Angle bras / tronc G', unit: '°', group: 'Articulations' },
  { key: 'shoulderR', label: 'Angle bras / tronc D', unit: '°', group: 'Articulations' },
  { key: 'wristSpeedL', label: 'Vitesse poignet G', unit: 'm/s', group: 'Vitesses' },
  { key: 'wristSpeedR', label: 'Vitesse poignet D', unit: 'm/s', group: 'Vitesses' },
  { key: 'pelvisYawRate', label: 'Vitesse de rotation du bassin', unit: '°/s', group: 'Vitesses' },
];

export const PAIR_METRICS = [
  { key: 'comDist', label: 'Distance horizontale CoM A–B', unit: 'm', group: 'Relation' },
  { key: 'relHeading', label: 'Orientation relative des bassins (0 = même sens)', unit: '°', group: 'Relation' },
  { key: 'bearingAB', label: 'Position de B vue par A (0 = devant, ±90 = côté)', unit: '°', group: 'Relation' },
  { key: 'bearingBA', label: 'Position de A vue par B (0 = devant, ±90 = côté)', unit: '°', group: 'Relation' },
];

/**
 * @param frames reconstruction.frames ([A|null, B|null] avec joints scène)
 * @param fps fréquence d'analyse
 */
export function computeMetrics(frames, fps, { contactTol = 0.1, derivSigma = 1.5 } = {}) {
  const n = frames.length;
  const dt = 1 / fps;
  const nan = () => new Float64Array(n).fill(NaN);

  const persons = [0, 1].map((k) => {
    const s = Object.fromEntries(METRICS.map((m) => [m.key, nan()]));
    const com = [nan(), nan(), nan()];
    const heading = [nan(), nan()];
    const wrist = { L: [nan(), nan(), nan()], R: [nan(), nan(), nan()] };
    const perFrame = new Array(n).fill(null);

    for (let i = 0; i < n; i++) {
      const p = frames[i][k];
      if (!p) continue;
      const P = p.joints;
      const c = centerOfMass(P, 3);
      const c2d = centerOfMass(p.img, 2);
      com.forEach((arr, d) => { arr[i] = c[d]; });
      const midSh = point(P, mid(LM.L_SHOULDER, LM.R_SHOULDER), 3);
      const midHip = point(P, mid(LM.L_HIP, LM.R_HIP), 3);
      s.comY[i] = c[1];
      s.trunkTilt[i] = angleBetween(v3.sub(midSh, midHip), [0, 1, 0]);
      s.kneeL[i] = 180 - angleAt(J(P, LM.L_HIP), J(P, LM.L_KNEE), J(P, LM.L_ANKLE));
      s.kneeR[i] = 180 - angleAt(J(P, LM.R_HIP), J(P, LM.R_KNEE), J(P, LM.R_ANKLE));
      s.hipL[i] = 180 - angleAt(J(P, LM.L_SHOULDER), J(P, LM.L_HIP), J(P, LM.L_KNEE));
      s.hipR[i] = 180 - angleAt(J(P, LM.R_SHOULDER), J(P, LM.R_HIP), J(P, LM.R_KNEE));
      s.elbowL[i] = 180 - angleAt(J(P, LM.L_SHOULDER), J(P, LM.L_ELBOW), J(P, LM.L_WRIST));
      s.elbowR[i] = 180 - angleAt(J(P, LM.R_SHOULDER), J(P, LM.R_ELBOW), J(P, LM.R_WRIST));
      s.shoulderL[i] = angleAt(J(P, LM.L_HIP), J(P, LM.L_SHOULDER), J(P, LM.L_ELBOW));
      s.shoulderR[i] = angleAt(J(P, LM.R_HIP), J(P, LM.R_SHOULDER), J(P, LM.R_ELBOW));
      const h = pelvisHeading(P);
      heading[0][i] = h[0]; heading[1][i] = h[1];
      for (const side of ['L', 'R']) {
        const w = J(P, side === 'L' ? LM.L_WRIST : LM.R_WRIST);
        wrist[side].forEach((arr, d) => { arr[i] = w[d]; });
      }
      const bos = baseOfSupport(P, contactTol);
      s.margin[i] = signedMargin([c[0], c[2]], bos.hull);
      perFrame[i] = { com: c, com2d: c2d, bos };
    }

    // Dérivées (lissées avant dérivation).
    const sm = (a) => gaussianSmooth(a, derivSigma);
    const vcom = com.map((a) => derivative(sm(a), dt));
    for (let i = 0; i < n; i++) {
      s.comSpeed[i] = Math.hypot(vcom[0][i], vcom[2][i]);
      const pf = perFrame[i];
      if (pf && !Number.isNaN(vcom[0][i]) && pf.com[1] > 0.2) {
        // Centre de masse extrapolé (Hof et al., 2005) : XCoM = CoM + v / ω0, ω0 = √(g / l).
        const w0 = Math.sqrt(G / pf.com[1]);
        const x = [pf.com[0] + vcom[0][i] / w0, pf.com[2] + vcom[2][i] / w0];
        pf.xcom = x;
        s.marginXcom[i] = signedMargin(x, pf.bos.hull);
      }
    }
    for (const side of ['L', 'R']) {
      const v = wrist[side].map((a) => derivative(sm(a), dt));
      const key = side === 'L' ? 'wristSpeedL' : 'wristSpeedR';
      for (let i = 0; i < n; i++) s[key][i] = Math.hypot(v[0][i], v[1][i], v[2][i]);
    }
    // Vitesse de lacet du bassin (angle déroulé).
    const yaw = nan();
    let prev = NaN, acc = 0;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(heading[0][i])) { prev = NaN; continue; }
      const a = Math.atan2(heading[0][i], heading[1][i]) * 180 / Math.PI;
      if (!Number.isNaN(prev)) {
        let d = a - prev;
        if (d > 180) d -= 360; if (d < -180) d += 360;
        acc += d;
      } else acc = a;
      yaw[i] = acc; prev = a;
    }
    s.pelvisYawRate = derivative(sm(yaw), dt);

    return { series: s, com, heading, perFrame };
  });

  const pair = Object.fromEntries(PAIR_METRICS.map((m) => [m.key, nan()]));
  const [A, B] = persons;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(A.com[0][i]) || Number.isNaN(B.com[0][i])) continue;
    const ab = [B.com[0][i] - A.com[0][i], B.com[2][i] - A.com[2][i]];
    pair.comDist[i] = Math.hypot(ab[0], ab[1]);
    const hA = [A.heading[0][i], A.heading[1][i]];
    const hB = [B.heading[0][i], B.heading[1][i]];
    pair.relHeading[i] = signedAngle2(hA, hB);
    pair.bearingAB[i] = signedAngle2(hA, ab);
    pair.bearingBA[i] = signedAngle2(hB, [-ab[0], -ab[1]]);
  }

  return { persons, pair };
}
