// @ts-check
// App thử của P0: chứng minh Three + OrbitControls + nhiều module + CSS chạy được
// khi gộp thành một file và mở bằng file:// lúc không có mạng.
import * as THREE from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { externalRequests } from './probe.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x050405, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(3.2, 2.6, 3.6);

scene.add(new THREE.HemisphereLight(0xfff1dd, 0x0a0806, 0.35));
const key = new THREE.DirectionalLight(0xffd9a8, 2.2);
key.position.set(-3, 5, 2);
scene.add(key);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xa8834a, metalness: 1, roughness: 0.42 })
);
scene.add(box);
scene.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.4, 1.4, 1.4)),
  new THREE.LineBasicMaterial({ color: 0xe8e0cf, transparent: true, opacity: 0.25 })
));

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function frame() {
  controls.update();
  box.rotation.y += 0.004;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const ext = externalRequests();
const cssOk = getComputedStyle(document.body).backgroundColor === 'rgb(5, 4, 5)';
const lines = [
  'PROOF · THREE r' + THREE.REVISION,
  'PROTOCOL · ' + location.protocol,
  'CSS · ' + (cssOk ? 'OK' : 'MISSING'),
  'EXTERNAL REQUESTS · ' + ext.length,
  'DRAG TO ORBIT',
];
status.textContent = lines.join('\n');
if (!cssOk || ext.length) status.classList.add('fail');

// Hook cho kiểm tra tự động
/** @type {any} */ (window).__proof = { ok: cssOk && ext.length === 0, ext, revision: THREE.REVISION };
