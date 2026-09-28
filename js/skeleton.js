// Topologie du squelette MediaPipe Pose (33 points, modèle BlazePose GHUM).

export const N_LANDMARKS = 33;

export const LM = {
  NOSE: 0,
  L_EYE_IN: 1, L_EYE: 2, L_EYE_OUT: 3,
  R_EYE_IN: 4, R_EYE: 5, R_EYE_OUT: 6,
  L_EAR: 7, R_EAR: 8,
  MOUTH_L: 9, MOUTH_R: 10,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_PINKY: 17, R_PINKY: 18,
  L_INDEX: 19, R_INDEX: 20,
  L_THUMB: 21, R_THUMB: 22,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32,
};

// Segments dessinés (le visage est réduit à nez + oreilles pour la lisibilité).
export const BONES = [
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_WRIST, LM.L_INDEX], [LM.L_WRIST, LM.L_PINKY], [LM.L_INDEX, LM.L_PINKY],
  [LM.R_WRIST, LM.R_INDEX], [LM.R_WRIST, LM.R_PINKY], [LM.R_INDEX, LM.R_PINKY],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
  [LM.L_ANKLE, LM.L_HEEL], [LM.L_HEEL, LM.L_FOOT], [LM.L_ANKLE, LM.L_FOOT],
  [LM.R_ANKLE, LM.R_HEEL], [LM.R_HEEL, LM.R_FOOT], [LM.R_ANKLE, LM.R_FOOT],
  [LM.NOSE, LM.L_EAR], [LM.NOSE, LM.R_EAR],
];

// Côté du segment, pour distinguer gauche/droite à l'affichage.
export function boneSide([a, b]) {
  const left = (i) => i % 2 === 1 && i > 0;
  const right = (i) => i % 2 === 0 && i > 0;
  if (left(a) && left(b)) return 'L';
  if (right(a) && right(b)) return 'R';
  return 'C';
}

// Points utilisés pour l'appui au sol.
export const FOOT_POINTS = {
  L: [LM.L_ANKLE, LM.L_HEEL, LM.L_FOOT],
  R: [LM.R_ANKLE, LM.R_HEEL, LM.R_FOOT],
};

// Points dessinés comme articulations.
export const JOINTS = [
  LM.NOSE, LM.L_EAR, LM.R_EAR,
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
  LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT,
];
