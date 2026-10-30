import { ArrowRight, Hand, MousePointer2, Sparkles, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { api, jsonBody } from '../api';
import type { Draw, TarotCard } from '../types';
import { errorMessage, useReducedMotion } from '../utils';
import { Button, InlineNotice, Modal } from './ui';

const WEBGL_ROUND_SIZE = 15;
const FALLBACK_ROUND_SIZE = 9;
type CeremonyPhase = 'revealing' | 'shuffle' | 'fan' | 'flipping' | 'complete';

function backTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 420;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 256, 420);
    gradient.addColorStop(0, '#251738');
    gradient.addColorStop(1, '#0e0a18');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 420);
    context.strokeStyle = '#b99add';
    context.lineWidth = 3;
    context.strokeRect(12, 12, 232, 396);
    context.strokeStyle = '#e7c98f88';
    context.lineWidth = 1;
    context.strokeRect(21, 21, 214, 378);
    context.beginPath();
    context.arc(128, 196, 61, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(145, 181, 43, 0, Math.PI * 2);
    context.strokeStyle = '#e7c98f';
    context.lineWidth = 5;
    context.stroke();
    context.fillStyle = '#f5dfaa';
    context.font = '34px serif';
    context.textAlign = 'center';
    context.fillText('✦', 104, 210);
    context.font = '13px serif';
    context.fillText('ASTRAL VEIL', 128, 342);
    for (let index = 0; index < 24; index += 1) {
      const x = 30 + ((index * 67) % 196);
      const y = 35 + ((index * 97) % 340);
      context.fillRect(x, y, index % 3 === 0 ? 2 : 1, index % 3 === 0 ? 2 : 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function frontTexture(card: TarotCard): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 420;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(128, 170, 10, 128, 210, 230);
    gradient.addColorStop(0, '#5c3b78');
    gradient.addColorStop(1, '#130d20');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 420);
    context.strokeStyle = '#e7c98f';
    context.lineWidth = 3;
    context.strokeRect(12, 12, 232, 396);
    context.fillStyle = '#f4e8fa';
    context.textAlign = 'center';
    context.font = '52px serif';
    context.fillText(card.arcana === 'major' ? '✧' : '❖', 128, 178);
    context.font = 'bold 27px "Microsoft YaHei", serif';
    context.fillText(card.name_zh, 128, 294);
    context.fillStyle = '#d9bd8c';
    context.font = '15px serif';
    context.fillText(card.orientation_zh, 128, 329);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function prepareFrontTexture(texture: THREE.Texture, card: TarotCard): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = -1;
  texture.offset.x = 1;
  texture.center.set(0.5, 0.5);
  texture.rotation = card.orientation === 'reversed' ? Math.PI : 0;
}

function ThreeDeck({
  deckCount,
  phase,
  selectedMesh,
  selectedCard,
  onSelect,
  onUnavailable,
}: {
  deckCount: number;
  phase: CeremonyPhase;
  selectedMesh: number | null;
  selectedCard: TarotCard | null;
  onSelect: (index: number) => void;
  onUnavailable: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef({ phase, selectedMesh, selectedCard });
  const selectRef = useRef(onSelect);
  const unavailableRef = useRef(onUnavailable);
  liveRef.current = { phase, selectedMesh, selectedCard };
  selectRef.current = onSelect;
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    const host = hostRef.current;
    let alive = true;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      unavailableRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 720 ? 1.25 : 1.6));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 7.4);
    const geometry = new THREE.PlaneGeometry(0.76, 1.25);
    const sharedBack = backTexture();
    const meshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let index = 0; index < deckCount; index += 1) {
      const material = new THREE.MeshBasicMaterial({ map: sharedBack, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, -0.1 + index * 0.004, index * 0.012);
      mesh.userData.index = index;
      mesh.userData.selected = false;
      scene.add(mesh);
      meshes.push(mesh);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hitTest = (event: PointerEvent, select: boolean) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes).find(({ object }) => !object.userData.selected);
      renderer.domElement.style.cursor = hit && liveRef.current.phase === 'fan' ? 'pointer' : 'default';
      if (select && hit && liveRef.current.phase === 'fan') selectRef.current(hit.object.userData.index as number);
    };
    const onPointerDown = (event: PointerEvent) => hitTest(event, true);
    const onPointerMove = (event: PointerEvent) => hitTest(event, false);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = camera.aspect < 1 ? 9.2 : 7.4;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    let lastSelected: number | null = null;
    let flipStarted = 0;
    let flipMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    let textureApplied = false;
    const particles: Array<{ points: THREE.Points; material: THREE.PointsMaterial; born: number }> = [];
    const start = performance.now();

    const animate = (now: number) => {
      const time = (now - start) / 1000;
      const live = liveRef.current;
      if (live.selectedMesh !== null && live.selectedMesh !== lastSelected) {
        lastSelected = live.selectedMesh;
        flipMesh = meshes[lastSelected];
        flipMesh.userData.selected = true;
        flipStarted = now;
        textureApplied = false;
        const positions = new Float32Array(36 * 3);
        for (let index = 0; index < 36; index += 1) {
          positions[index * 3] = Math.sin(index * 2.17) * 0.58;
          positions[index * 3 + 1] = Math.cos(index * 1.73) * 0.78;
          positions[index * 3 + 2] = 0.1 + (index % 5) * 0.035;
        }
        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({ color: 0xe7c98f, size: 0.045, transparent: true, opacity: 0.9, depthWrite: false });
        const points = new THREE.Points(particleGeometry, material);
        points.position.copy(flipMesh.position);
        scene.add(points);
        particles.push({ points, material, born: now });
      }

      meshes.forEach((mesh, index) => {
        const center = index - (deckCount - 1) / 2;
        if (live.phase === 'shuffle' || live.phase === 'revealing') {
          const envelope = 0.65 + Math.sin(time * 2.4 + index * 0.2) * 0.25;
          mesh.position.x += (Math.sin(time * 3.1 + index * 0.72) * 1.75 * envelope - mesh.position.x) * 0.09;
          mesh.position.y += (Math.cos(time * 2.7 + index * 0.51) * 0.5 - mesh.position.y) * 0.09;
          mesh.rotation.z += (Math.sin(time * 2.2 + index) * 0.4 - mesh.rotation.z) * 0.08;
        } else {
          const spacing = Math.min(0.53, 7.2 / deckCount);
          const normalized = center / Math.max((deckCount - 1) / 2, 1);
          const selectedLift = mesh.userData.selected ? 0.85 : 0;
          mesh.position.x += (center * spacing - mesh.position.x) * 0.085;
          mesh.position.y += (normalized * normalized * -0.52 + selectedLift - 0.05 - mesh.position.y) * 0.085;
          mesh.position.z += (index * 0.012 - mesh.position.z) * 0.08;
          mesh.rotation.z += (-normalized * 0.34 - mesh.rotation.z) * 0.085;
        }
        if (mesh !== flipMesh) mesh.rotation.y += ((mesh.userData.selected ? Math.PI : 0) - mesh.rotation.y) * 0.08;
      });

      if (flipMesh && lastSelected !== null) {
        const progress = Math.min((now - flipStarted) / 650, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        flipMesh.rotation.y = eased * Math.PI;
        if (progress > 0.45 && !textureApplied && live.selectedCard) {
          const targetMesh = flipMesh;
          const targetCard = live.selectedCard;
          const material = targetMesh.material;
          const textureToken = Symbol(targetCard.id);
          targetMesh.userData.textureToken = textureToken;
          if (material.map && material.map !== sharedBack) material.map.dispose();
          const generated = frontTexture(targetCard);
          prepareFrontTexture(generated, targetCard);
          material.map = generated;
          material.needsUpdate = true;
          textureApplied = true;
          new THREE.TextureLoader().load(`/cards/${encodeURIComponent(targetCard.id)}.jpg`, (texture) => {
            if (!alive || targetMesh.userData.textureToken !== textureToken) {
              texture.dispose();
              return;
            }
            prepareFrontTexture(texture, targetCard);
            if (material.map && material.map !== sharedBack) material.map.dispose();
            material.map = texture;
            material.needsUpdate = true;
          }, undefined, () => undefined);
        }
      }

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        const progress = Math.min((now - particle.born) / 850, 1);
        particle.points.scale.setScalar(0.5 + (1 - Math.pow(1 - progress, 2)) * 1.7);
        particle.points.rotation.z = progress * 0.7;
        particle.material.opacity = (1 - progress) * 0.85;
        if (progress >= 1) {
          scene.remove(particle.points);
          particle.points.geometry.dispose();
          particle.material.dispose();
          particles.splice(index, 1);
        }
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      meshes.forEach((mesh) => {
        if (mesh.material.map && mesh.material.map !== sharedBack) mesh.material.map.dispose();
        mesh.material.dispose();
      });
      sharedBack.dispose();
      geometry.dispose();
      particles.forEach(({ points, material }) => {
        points.geometry.dispose();
        material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="three-deck" ref={hostRef} />;
}

export function Ceremony({ draw, conversationId, onRevealed, onFinish, onClose }: {
  draw: Draw;
  conversationId: string;
  onRevealed: (draw: Draw) => void;
  onFinish: (draw: Draw) => void;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<CeremonyPhase>('revealing');
  const [result, setResult] = useState<Draw | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedMesh, setSelectedMesh] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [webglFailed, setWebglFailed] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [round, setRound] = useState(0);
  const usedMeshes = useRef(new Set<number>());
  const revealPromise = useRef<Promise<Draw> | null>(null);
  const revealedRef = useRef(onRevealed);
  const finishRef = useRef(onFinish);
  const drawSnapshot = useRef(draw);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  revealedRef.current = onRevealed;
  finishRef.current = onFinish;
  const total = result?.positions.length ?? draw.positions.length;
  const fallback = reducedMotion || webglFailed;
  const deckSize = fallback ? FALLBACK_ROUND_SIZE : WEBGL_ROUND_SIZE;

  useEffect(() => {
    let active = true;
    const snapshot = drawSnapshot.current;
    setError('');
    setResult(null);
    setSelectedCount(0);
    setSelectedMesh(null);
    setRound(0);
    usedMeshes.current.clear();
    setPhase('revealing');
    const request = snapshot.status === 'proposed'
      ? api<Draw>(`/api/conversations/${conversationId}/draws/${snapshot.id}/reveal`, { method: 'POST', body: jsonBody({}) })
      : Promise.resolve(snapshot);
    revealPromise.current = request;
    request.then((revealed) => {
      revealedRef.current(revealed);
      if (!active) return;
      setResult(revealed);
      setPhase(reducedRef.current ? 'fan' : 'shuffle');
    }).catch((reason) => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [attempt, conversationId, draw.id]);

  useEffect(() => {
    if (phase !== 'shuffle') return;
    const timer = window.setTimeout(() => setPhase('fan'), 1450);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'flipping') return;
    const timer = window.setTimeout(() => {
      setSelectedMesh(null);
      if (selectedCount >= total) {
        setPhase('complete');
      } else {
        if (usedMeshes.current.size >= deckSize) {
          usedMeshes.current.clear();
          setRound((value) => value + 1);
        }
        setPhase('fan');
      }
    }, reducedMotion || webglFailed ? 120 : 720);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion, selectedCount, total, deckSize, webglFailed]);

  const choose = (meshIndex: number) => {
    if (phase !== 'fan' || !result || meshIndex >= deckSize || usedMeshes.current.has(meshIndex)) return;
    usedMeshes.current.add(meshIndex);
    setSelectedMesh(meshIndex);
    setSelectedCount((count) => count + 1);
    setPhase('flipping');
  };

  const chooseByFeeling = () => {
    const available = Array.from({ length: deckSize }, (_, index) => index).filter((index) => !usedMeshes.current.has(index));
    if (available.length) choose(available[Math.floor(Math.random() * available.length)]);
  };

  const skip = async () => {
    if (!revealPromise.current) return;
    setSkipping(true);
    try {
      const revealed = await revealPromise.current;
      finishRef.current(revealed);
    } catch (reason) {
      setError(errorMessage(reason));
      setSkipping(false);
    }
  };

  const activeCard = result && selectedCount > 0 ? result.cards[selectedCount - 1] : null;

  return (
    <Modal title={draw.spread_name} eyebrow="星牌仪式" onClose={onClose} className="ceremony-modal" closeDisabled={skipping}>
      <div className="ceremony-toolbar">
        <div className="ceremony-progress" aria-label={`已选择 ${selectedCount} 张，共 ${total} 张`}>
          {Array.from({ length: total }, (_, index) => <i key={index} className={index < selectedCount ? 'is-filled' : ''} />)}
        </div>
        <Button variant="ghost" onClick={skip} loading={skipping} disabled={phase === 'complete'}>跳过仪式</Button>
      </div>
      <div className="ceremony-stage">
        <div className="ceremony-stage__halo" aria-hidden="true" />
        {phase === 'revealing' && !error && <div className="ceremony-wait"><WandSparkles /><span>正在请星牌归位</span></div>}
        {error && <div className="ceremony-error"><InlineNotice tone="error">{error}</InlineNotice><Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>重新连接</Button></div>}
        {!error && phase !== 'revealing' && result && !fallback && (
          <ThreeDeck key={`${round}-${deckSize}`} deckCount={deckSize} phase={phase} selectedMesh={selectedMesh} selectedCard={activeCard} onSelect={choose} onUnavailable={() => { usedMeshes.current.clear(); setRound((value) => value + 1); setWebglFailed(true); setPhase('fan'); }} />
        )}
        {!error && phase !== 'revealing' && result && fallback && phase !== 'complete' && (
          <div className="fallback-fan" aria-label="请选择星牌">
            {Array.from({ length: deckSize }, (_, index) => (
              <button key={`${round}-${index}`} disabled={phase !== 'fan' || usedMeshes.current.has(index)} onClick={() => choose(index)} aria-label={`选择第 ${index + 1} 张星牌`} style={{ '--fan-index': index - (deckSize - 1) / 2 } as React.CSSProperties}><span>☾</span></button>
            ))}
          </div>
        )}
        {phase === 'complete' && result && (
          <div className="ceremony-complete"><Sparkles /><span className="eyebrow">星牌已就位</span><h3>答案已在牌面间苏醒</h3><div>{result.cards.map((card, index) => <span key={`${card.id}-${index}`}>{card.name_zh}<small>{card.orientation_zh}</small></span>)}</div></div>
        )}
      </div>
      <footer className="ceremony-footer">
        <span className="ceremony-hint">{phase === 'fan' ? <><MousePointer2 />凭直觉点选一张牌</> : phase === 'flipping' ? <><Sparkles />{activeCard ? `${activeCard.position} · ${activeCard.name_zh}` : '星牌正在转身'}</> : phase === 'complete' ? '每一次相逢，都恰逢其时' : <><Hand />让心绪慢慢沉静</>}</span>
        {phase === 'fan' && <Button variant="secondary" onClick={chooseByFeeling}>为我感应此牌</Button>}
        {phase === 'complete' && result && <Button onClick={() => finishRef.current(result)}>查看牌面<ArrowRight /></Button>}
      </footer>
    </Modal>
  );
}
