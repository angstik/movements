// Vue 3D filaire des deux personnes, orientable librement (Three.js).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BONES, JOINTS, boneSide } from './skeleton.js';

const TRAIL = 45; // images de traînée du CoM

export class Scene3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.camera.position.set(0, 1.6, 4.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;

    this.grid = new THREE.GridHelper(10, 20);
    this.scene.add(this.grid);
    this.scene.add(new THREE.AxesHelper(0.3));

    this.people = [0, 1].map(() => this.#makePerson());
    this.camMarker = new THREE.Group();
    this.scene.add(this.camMarker);
    this.follow = true;
    this.lastTarget = new THREE.Vector3(0, 0.9, 0);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  #makePerson() {
    const group = new THREE.Group();
    const bonesGeo = new THREE.BufferGeometry();
    bonesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
    bonesGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
    const bones = new THREE.LineSegments(bonesGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
    const jointMat = new THREE.MeshBasicMaterial();
    const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 10, 8), jointMat, JOINTS.length);
    const comMat = new THREE.MeshBasicMaterial();
    const com = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), comMat);
    const lineMat = new THREE.LineDashedMaterial({ dashSize: 0.05, gapSize: 0.04 });
    const plumbGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const plumb = new THREE.Line(plumbGeo, lineMat);
    const bosGeo = new THREE.BufferGeometry();
    bosGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 16), 3));
    const bos = new THREE.LineLoop(bosGeo, new THREE.LineBasicMaterial());
    const xcom = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }));
    group.add(bones, joints, com, plumb, bos, xcom, trail);
    this.scene.add(group);
    return { group, bones, joints, com, plumb, bos, xcom, trail, color: new THREE.Color() };
  }

  setTheme({ grid, gridMinor }) {
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = new THREE.GridHelper(10, 20, grid, gridMinor);
    this.scene.add(this.grid);
  }

  setColors(colors, comColor = '#ffffff') {
    this.people.forEach((p, k) => {
      p.color.set(colors[k]);
      const light = p.color.clone().lerp(new THREE.Color('#ffffff'), 0.45);
      const dark = p.color.clone().multiplyScalar(0.8);
      const col = p.bones.geometry.getAttribute('color');
      BONES.forEach((bone, i) => {
        const side = boneSide(bone);
        const c = side === 'L' ? p.color : side === 'R' ? light : dark;
        col.setXYZ(i * 2, c.r, c.g, c.b);
        col.setXYZ(i * 2 + 1, c.r, c.g, c.b);
      });
      col.needsUpdate = true;
      p.joints.material.color.copy(p.color);
      p.com.material.color.set(comColor);
      p.plumb.material.color.copy(p.color);
      p.bos.material.color.copy(p.color);
      p.xcom.material.color.copy(p.color);
      p.trail.material.color.copy(p.color);
    });
  }

  setCameraPose(cam) {
    this.cameraPose = cam;
    this.scene.remove(this.camMarker);
    this.camMarker = new THREE.Group();
    const pos = new THREE.Vector3(...cam.position);
    const fwd = new THREE.Vector3(...cam.forward).normalize();
    const up = new THREE.Vector3(...cam.up).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const d = 0.35, hw = d * Math.tan((cam.hfov * Math.PI / 180) / 2), hh = hw * cam.height / cam.width;
    const c = pos.clone().addScaledVector(fwd, d);
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => c.clone().addScaledVector(right, sx * hw).addScaledVector(up, sy * hh));
    const pts = [];
    for (let i = 0; i < 4; i++) pts.push(pos, corners[i], corners[i], corners[(i + 1) % 4]);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.camMarker.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#888888' })));
    this.scene.add(this.camMarker);
  }

  update(persons, metricsFrame, trails) {
    const tmp = new THREE.Object3D();
    const targets = [];
    persons.forEach((p, k) => {
      const view = this.people[k];
      view.group.visible = !!p;
      if (!p) return;
      const P = p.joints;
      const pos = view.bones.geometry.getAttribute('position');
      BONES.forEach(([a, b], i) => {
        pos.setXYZ(i * 2, P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
        pos.setXYZ(i * 2 + 1, P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
      });
      pos.needsUpdate = true;
      view.bones.geometry.computeBoundingSphere();
      JOINTS.forEach((j, i) => {
        tmp.position.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
        tmp.updateMatrix();
        view.joints.setMatrixAt(i, tmp.matrix);
      });
      view.joints.instanceMatrix.needsUpdate = true;

      const m = metricsFrame?.[k];
      view.com.visible = view.plumb.visible = !!m;
      view.bos.visible = !!(m && m.bos.hull.length >= 2);
      view.xcom.visible = !!(m && m.xcom);
      if (m) {
        const [x, y, z] = m.com;
        view.com.position.set(x, y, z);
        targets.push(new THREE.Vector3(x, y, z));
        const pp = view.plumb.geometry.getAttribute('position');
        pp.setXYZ(0, x, y, z); pp.setXYZ(1, x, 0.002, z);
        pp.needsUpdate = true;
        view.plumb.computeLineDistances();
        const hull = m.bos.hull.slice(0, 16);
        const bp = view.bos.geometry.getAttribute('position');
        hull.forEach(([hx, hz], i) => bp.setXYZ(i, hx, 0.003, hz));
        view.bos.geometry.setDrawRange(0, hull.length);
        bp.needsUpdate = true;
        if (m.xcom) view.xcom.position.set(m.xcom[0], 0.004, m.xcom[1]);
      }
      const tr = trails?.[k] || [];
      const tp = view.trail.geometry.getAttribute('position');
      tr.slice(-TRAIL).forEach((c, i) => tp.setXYZ(i, c[0], 0.002, c[2]));
      view.trail.geometry.setDrawRange(0, Math.min(TRAIL, tr.length));
      tp.needsUpdate = true;
    });
    if (this.follow && targets.length) {
      const t = targets.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / targets.length);
      t.y = 0.9;
      const delta = t.clone().sub(this.lastTarget);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.lastTarget.copy(t);
    }
  }

  setView(name) {
    const t = this.controls.target.clone();
    const dist = 4.5;
    if (name === 'camera' && this.cameraPose) {
      const c = this.cameraPose;
      this.camera.position.set(...c.position);
      this.camera.up.set(...c.up);
      const vfov = 2 * Math.atan(Math.tan((c.hfov * Math.PI / 180) / 2) * c.height / c.width) * 180 / Math.PI;
      this.camera.fov = vfov;
      this.camera.updateProjectionMatrix();
      const look = new THREE.Vector3(...c.position).addScaledVector(new THREE.Vector3(...c.forward), 3);
      this.controls.target.copy(look);
      this.lastTarget.set(look.x, 0.9, look.z);
      this.follow = false;
      this.controls.update();
      this.camera.up.set(0, 1, 0);
      return;
    }
    this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 1, 0);
    const offsets = {
      front: [0, 0.7, dist],
      back: [0, 0.7, -dist],
      left: [-dist, 0.7, 0],
      right: [dist, 0.7, 0],
      top: [0, dist * 1.3, 0.001],
      iso: [dist * 0.7, dist * 0.6, dist * 0.7],
    };
    const o = offsets[name] || offsets.front;
    this.camera.position.set(t.x + o[0], t.y + o[1], t.z + o[2]);
    this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
