# Aïki Filaire

Analyse filaire et mécanique de techniques d'aïkido à partir d'une **vidéo mono-caméra (smartphone)**,
100 % navigateur : aucune installation, aucune donnée envoyée sur un serveur (la vidéo reste locale).

## Lancer

Les modules ES imposent un serveur HTTP (pas `file://`) :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

Ou publier le dépôt tel quel sur GitHub Pages. Navigateur conseillé : Chrome / Edge récent (WebGL2).
Les bibliothèques sont chargées depuis jsDelivr, le modèle depuis `storage.googleapis.com` : une connexion
est nécessaire au premier chargement.

## Sur téléphone

- **● Filmer** ouvre directement la caméra ; **Ouvrir une vidéo…** ouvre la galerie.
- Interface à onglets (3D / Courbes / Réglages) sous la vidéo ; modèle `lite` par défaut.
- L'écran est maintenu allumé pendant l'analyse (Wake Lock, si le navigateur le permet).
  Garder l'onglet au premier plan : en arrière-plan, le navigateur suspend le traitement.
- Installable sur l'écran d'accueil (manifeste web).

## Bibliothèque locale

Chaque vidéo ouverte ou filmée est conservée (option désactivable) dans le stockage du navigateur (IndexedDB),
avec son analyse, enregistrée automatiquement : identités corrigées et réglages compris. On retrouve et rouvre
tout depuis **Bibliothèque**, sans rien renvoyer sur un serveur. Le stockage est propre à l'appareil et au navigateur.
Il peut être vidé par le système si l'espace manque, sauf si le navigateur accorde le stockage persistant.

## Vidéos en ligne

- **URL…** : charge un lien direct vers un fichier vidéo, à condition que le serveur autorise CORS.
- **YouTube** : impossible depuis une page web, car YouTube ne sert pas de fichier vidéo lisible par un site tiers.
  Télécharger la vidéo à part (par exemple avec `yt-dlp`), uniquement si les conditions d'utilisation et
  les droits de la vidéo le permettent (vos propres vidéos, licence Creative Commons, accord de l'auteur),
  puis ouvrir le fichier.

## Chaîne de traitement

| Étape | Module | Méthode |
|---|---|---|
| Extraction 2D + 3D locale | `js/pose.js` | MediaPipe Pose Landmarker (`@mediapipe/tasks-vision` 1.0.1), 33 points, `numPoses: 2`, image par image (seek) à la fréquence choisie |
| Identités A/B | `js/tracker.js` | Suppression des doublons (2 poses sur un même corps), association par continuité spatiale (position prédite + échelle) ; correction manuelle « Inverser A ↔ B à partir d'ici » |
| Scène 3D commune | `js/reconstruct.js` | Les coordonnées *world* MediaPipe sont centrées sur chaque bassin : la position relative est restituée par un modèle sténopé (profondeur = f / échelle px·m⁻¹, f déduit du champ horizontal supposé). Sol estimé par ajustement de plan robuste sur les appuis. Interpolation des trous courts et lissage gaussien à phase nulle |
| Indicateurs | `js/biomech.js` | CoM segmentaire (de Leva 1996), polygone de sustentation, marge statique, XCoM (Hof 2005), angles articulaires 3D, vitesses, orientation du bassin, relations Tori/Uke |
| Bibliothèque | `js/library.js` | IndexedDB : vidéo (blob), vignette, analyse sérialisée |
| Affichage | `js/overlay.js`, `js/scene3d.js`, `js/charts.js` | Surcouche filaire sur la vidéo, vue 3D orbitale (Three.js) avec préréglages Smartphone / Face / Profils / Dos / Dessus / 3/4, graphiques synchronisés |

## Indicateurs

- **Par pratiquant** : hauteur et vitesse horizontale du CoM, marge CoM ↔ polygone d'appui (> 0 = CoM dans l'appui),
  marge dynamique XCoM, inclinaison du tronc, flexions genoux, hanches et coudes, angle bras/tronc,
  vitesse des poignets, vitesse de rotation du bassin.
- **Couple** : distance horizontale CoM–CoM, orientation relative des bassins, position de l'un
  dans le repère de l'autre (0° = devant, ±90° = sur le côté, ±180° = derrière), utile pour irimi/tenkan.

Export **CSV** (indicateurs) et **JSON** (détections brutes + identités + scène 3D). Le JSON se recharge
pour reprendre l'analyse sans ré-extraction.

## Limites (à lire avant d'interpréter)

- **Monoculaire** : la profondeur est estimée. Elle est surtout fiable en relatif et sur des durées lissées ;
  la marge d'équilibre dans l'axe caméra est la grandeur la plus fragile.
- **Occlusions au contact** (kote-gaeshi, irimi-nage, immobilisations au sol) : identités qui s'échangent,
  membres attribués à la mauvaise personne. Vérifier avec « Détections brutes » et corriger avec l'inversion A/B.
- **Hakama** : les genoux et chevilles sont masqués, et leur position est déduite par le modèle.
  Les angles de genou et le contact des pieds sont donc peu fiables pour un pratiquant en hakama.
- **Chutes (ukemi)** : MediaPipe est entraîné surtout sur des personnes debout ; les poses inversées dégradent la détection.
- **Aucune force** : la dynamique inverse est impossible sans plateforme de force, et les efforts transmis
  entre les deux partenaires sont inconnus.
- Le modèle segmentaire utilise les valeurs masculines de de Leva, appliquées à des points MediaPipe, qui
  ne sont pas des repères anatomiques.

## Conseils de prise de vue

Téléphone **fixe** (trépied), horizontal, à hauteur de hanche, 4 à 6 m, les deux pratiquants entiers dans le cadre ;
filmer de préférence dans l'axe perpendiculaire à la ligne d'attaque. 60 im/s si possible, bon éclairage, fond dégagé.
Renseigner le champ de vision horizontal de l'objectif utilisé (≈ 65–75° pour un objectif principal ; varie selon le modèle).
