// Extraction des poses image par image avec MediaPipe Pose Landmarker (100 % navigateur).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { N_LANDMARKS } from './skeleton.js';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
};

const MAX_SIDE = 1280;

let fileset = null;
let landmarker = null;
let landmarkerKey = '';
// detectForVideo exige des horodatages strictement croissants, y compris entre deux analyses.
let lastTimestamp = 0;

export async function getLandmarker({ model = 'full', minDetection = 0.5, minPresence = 0.5, minTracking = 0.5 }, log) {
  const key = JSON.stringify([model, minDetection, minPresence, minTracking]);
  if (landmarker && landmarkerKey === key) return landmarker;
  if (landmarker) { landmarker.close(); landmarker = null; }
  if (!fileset) {
    log?.('Chargement du runtime MediaPipe (WASM)…');
    fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  }
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URLS[model], delegate },
    runningMode: 'VIDEO',
    numPoses: 2,
    minPoseDetectionConfidence: minDetection,
    minPosePresenceConfidence: minPresence,
    minTrackingConfidence: minTracking,
    outputSegmentationMasks: false,
  });
  log?.(`Chargement du modèle « ${model} »…`);
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
    log?.('Modèle chargé (GPU).');
  } catch (err) {
    console.warn('Délégué GPU indisponible, repli CPU', err);
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    log?.('Modèle chargé (CPU).');
  }
  landmarkerKey = key;
  return landmarker;
}

function seek(video, t) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Erreur de lecture vidéo')); };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = t;
  });
}

function packDetection(norm, world, width, height) {
  // img : pixels (x, y) + visibilité ; world : mètres, origine au milieu des hanches, axes caméra (y vers le bas).
  const img = new Float32Array(N_LANDMARKS * 3);
  const w = new Float32Array(N_LANDMARKS * 3);
  for (let i = 0; i < N_LANDMARKS; i++) {
    img[i * 3] = norm[i].x * width;
    img[i * 3 + 1] = norm[i].y * height;
    img[i * 3 + 2] = norm[i].visibility ?? 1;
    w[i * 3] = world[i].x;
    w[i * 3 + 1] = world[i].y;
    w[i * 3 + 2] = world[i].z;
  }
  return { img, world: w };
}

/**
 * Parcourt la vidéo de `start` à `end` au pas 1/fps et renvoie les détections brutes
 * (0, 1 ou 2 par image, sans identité).
 */
export async function extractPoses(video, { start, end, fps, onProgress, isCancelled, ...modelOptions }, log) {
  const lm = await getLandmarker(modelOptions, log);
  const width = video.videoWidth;
  const height = video.videoHeight;
  // Copie de chaque image dans un canvas : garantit que l'image analysée est bien celle
  // qui suit le `seeked` (certains navigateurs ne rafraîchissent pas la texture d'une vidéo en pause)
  // et réduit les vidéos 4K (les coordonnées normalisées restent valides).
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const frames = [];
  const step = 1 / fps;
  const total = Math.max(1, Math.floor((end - start) / step) + 1);
  video.pause();
  const t0 = performance.now();
  for (let n = 0; n < total; n++) {
    if (isCancelled?.()) break;
    const t = Math.min(start + n * step, video.duration - 1e-3);
    await seek(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    lastTimestamp = Math.max(lastTimestamp + 1, Math.round(performance.now()));
    const res = lm.detectForVideo(canvas, lastTimestamp);
    const detections = [];
    for (let p = 0; p < res.landmarks.length; p++) {
      detections.push(packDetection(res.landmarks[p], res.worldLandmarks[p], width, height));
    }
    frames.push({ t, detections });
    if (n % 5 === 0 || n === total - 1) {
      const elapsed = (performance.now() - t0) / 1000;
      onProgress?.((n + 1) / total, (n + 1) / elapsed);
    }
  }
  return { width, height, fps, frames };
}
