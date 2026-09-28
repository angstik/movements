// Attribution d'identité (A / B) aux détections, image par image.
// MediaPipe ne garantit pas l'ordre des poses : on associe par continuité spatiale.

import { LM, N_LANDMARKS } from './skeleton.js';

const TORSO = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];

function descriptor(det) {
  const p = det.img;
  let cx = 0, cy = 0;
  for (const i of TORSO) { cx += p[i * 3]; cy += p[i * 3 + 1]; }
  cx /= 4; cy /= 4;
  const midSh = [(p[LM.L_SHOULDER * 3] + p[LM.R_SHOULDER * 3]) / 2, (p[LM.L_SHOULDER * 3 + 1] + p[LM.R_SHOULDER * 3 + 1]) / 2];
  const midHip = [(p[LM.L_HIP * 3] + p[LM.R_HIP * 3]) / 2, (p[LM.L_HIP * 3 + 1] + p[LM.R_HIP * 3 + 1]) / 2];
  const size = Math.max(10, Math.hypot(midSh[0] - midHip[0], midSh[1] - midHip[1]));
  let vis = 0;
  for (let i = 0; i < N_LANDMARKS; i++) vis += p[i * 3 + 2];
  return { cx, cy, size, vis: vis / N_LANDMARKS };
}

function meanJointDistance(a, b) {
  let d = 0;
  for (let i = 11; i < N_LANDMARKS; i++) {
    d += Math.hypot(a.img[i * 3] - b.img[i * 3], a.img[i * 3 + 1] - b.img[i * 3 + 1]);
  }
  return d / (N_LANDMARKS - 11);
}

// Supprime les doublons (deux poses posées sur le même corps, fréquent au contact).
function dedupe(dets) {
  if (dets.length < 2) return dets;
  const [a, b] = dets;
  const da = descriptor(a), db = descriptor(b);
  const scale = Math.max(da.size, db.size);
  if (meanJointDistance(a, b) < 0.35 * scale) return [da.vis >= db.vis ? a : b];
  return dets;
}

function cost(track, d) {
  if (!track) return 0;
  const px = track.cx + track.vx * track.age;
  const py = track.cy + track.vy * track.age;
  const pos = Math.hypot(d.cx - px, d.cy - py) / track.size;
  const scale = Math.abs(Math.log(d.size / track.size));
  return pos + 2 * scale;
}

/**
 * @param frames [{t, detections:[{img, world}]}]
 * @returns tableau aligné sur frames : [personA|null, personB|null]
 */
export function assignIdentities(frames) {
  const tracks = [null, null];
  const out = [];
  const MAX_AGE = 15; // images sans détection avant oubli de la vitesse

  for (const frame of frames) {
    const dets = dedupe(frame.detections);
    const descs = dets.map(descriptor);
    const slot = [null, null];

    if (!tracks[0] && !tracks[1]) {
      // Initialisation : A = personne la plus à gauche de l'image.
      const order = descs.map((d, i) => i).sort((i, j) => descs[i].cx - descs[j].cx);
      order.forEach((di, k) => { slot[k] = di; });
    } else if (descs.length === 1) {
      const c0 = tracks[0] ? cost(tracks[0], descs[0]) : Infinity;
      const c1 = tracks[1] ? cost(tracks[1], descs[0]) : Infinity;
      if (c0 === Infinity && c1 === Infinity) slot[0] = 0;
      else slot[c0 <= c1 ? 0 : 1] = 0;
    } else if (descs.length >= 2) {
      const direct = cost(tracks[0], descs[0]) + cost(tracks[1], descs[1]);
      const swapped = cost(tracks[0], descs[1]) + cost(tracks[1], descs[0]);
      if (direct <= swapped) { slot[0] = 0; slot[1] = 1; } else { slot[0] = 1; slot[1] = 0; }
    }

    const persons = [null, null];
    for (let k = 0; k < 2; k++) {
      if (slot[k] === null) {
        if (tracks[k]) {
          tracks[k].age++;
          if (tracks[k].age > MAX_AGE) { tracks[k].vx = 0; tracks[k].vy = 0; }
        }
        continue;
      }
      const d = descs[slot[k]];
      persons[k] = dets[slot[k]];
      const prev = tracks[k];
      if (prev) {
        const dt = prev.age;
        const vx = (d.cx - prev.cx) / dt, vy = (d.cy - prev.cy) / dt;
        tracks[k] = { cx: d.cx, cy: d.cy, size: 0.7 * prev.size + 0.3 * d.size, vx: 0.5 * prev.vx + 0.5 * vx, vy: 0.5 * prev.vy + 0.5 * vy, age: 1 };
      } else {
        tracks[k] = { cx: d.cx, cy: d.cy, size: d.size, vx: 0, vy: 0, age: 1 };
      }
    }
    out.push(persons);
  }
  return out;
}

// Échange A et B à partir de l'image `fromIndex` (correction manuelle).
export function swapFrom(assigned, fromIndex) {
  for (let i = fromIndex; i < assigned.length; i++) assigned[i] = [assigned[i][1], assigned[i][0]];
}
