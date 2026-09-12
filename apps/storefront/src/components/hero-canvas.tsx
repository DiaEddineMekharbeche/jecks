'use client';

import { Environment, Float, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * The heavy half of the 3D hero: three.js, the renderer and the cap geometry.
 *
 * Kept in its own module so `hero-3d.tsx` can import it lazily. Nothing here is
 * evaluated, and none of it is downloaded, until the hero scrolls into view.
 *
 * Two caps, and the shop chooses. A model uploaded through the media library and picked
 * in Settings › Thème is loaded; with none, the procedural cap stands in, so a shop that
 * has never opened Blender still has a hero on its first day.
 *
 * The model is the better one when it exists — a real product photographed in 3D sells
 * better than a good approximation of a cap — but requiring one before the shop can open
 * would be the wrong trade.
 */
export default function HeroCanvas({
  animate,
  modelUrl,
}: {
  animate: boolean;
  modelUrl?: string | null;
}) {
  return (
    <Canvas
      // Cap the pixel ratio: a 3x phone screen triples the fragment cost for no
      // visible gain on a hero this size.
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      className="!absolute inset-0"
    >
      <PerspectiveCamera makeDefault position={[0, 0.35, 3.4]} fov={38} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 2]} intensity={2.2} color="#FFF3DC" />
      <directionalLight position={[-3, 1, -2]} intensity={0.7} color="#7AA8D1" />
      <Suspense fallback={null}>
        <Float
          speed={animate ? 1.2 : 0}
          rotationIntensity={animate ? 0.25 : 0}
          floatIntensity={animate ? 0.4 : 0}
        >
          {modelUrl ? <UploadedModel url={modelUrl} /> : <ProceduralCap animate={animate} />}
        </Float>
        <Environment preset="studio" />
      </Suspense>
    </Canvas>
  );
}

/**
 * The shop's own model.
 *
 * Scaled to the same box the procedural cap occupies, so swapping one for the other does
 * not move the camera or the lighting. A GLB exported at any scale therefore lands in
 * frame, which is the difference between "upload and see it" and "upload and file a bug".
 */
function UploadedModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());

    const largest = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.6 / largest;

    clone.position.sub(centre);
    clone.scale.setScalar(scale);
    clone.position.multiplyScalar(scale);

    return clone;
  }, [scene]);

  return <primitive object={model} />;
}

/** A six-panel cap: hemispherical crown, curved brim, button and a brass patch. */
function ProceduralCap({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!animate) return;
    const onMove = (event: PointerEvent) => {
      pointer.current = {
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [animate]);

  useFrame((_state, delta) => {
    const node = group.current;
    if (!node) return;
    if (animate) node.rotation.y += delta * 0.28;
    // Eased towards the pointer rather than snapped, so the cap reads as having weight.
    const targetX = pointer.current.y * 0.12;
    const targetZ = -pointer.current.x * 0.08;
    node.rotation.x += (targetX - node.rotation.x) * 0.05;
    node.rotation.z += (targetZ - node.rotation.z) * 0.05;
  });

  const brimGeometry = useMemo(() => {
    // A flattened half-annulus, bevelled and bent forward: a pre-curved trucker brim.
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 1.42, Math.PI * 0.08, Math.PI * 0.92, false);
    shape.absarc(0, 0, 0.98, Math.PI * 0.92, Math.PI * 0.08, true);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 3,
      curveSegments: 48,
    });
    geometry.center();
    return geometry;
  }, []);

  // Geometry and materials are disposed when the hero unmounts; three.js does not
  // garbage-collect GPU resources on its own.
  useEffect(() => () => brimGeometry.dispose(), [brimGeometry]);

  return (
    <group ref={group} position={[0, -0.15, 0]}>
      <mesh castShadow position={[0, 0.28, 0]}>
        <sphereGeometry args={[1, 64, 48, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
        <meshStandardMaterial
          color="#1F2A20"
          roughness={0.78}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0.28, 0]}>
        <torusGeometry args={[0.995, 0.045, 16, 64]} />
        <meshStandardMaterial color="#161D17" roughness={0.9} />
      </mesh>

      <mesh geometry={brimGeometry} position={[0, 0.24, 0.72]} rotation={[Math.PI / 2 + 0.22, 0, 0]}>
        <meshStandardMaterial color="#18211A" roughness={0.72} metalness={0.05} />
      </mesh>

      <mesh position={[0, 1.29, 0]}>
        <sphereGeometry args={[0.075, 24, 16]} />
        <meshStandardMaterial color="#D9B36A" roughness={0.35} metalness={0.85} />
      </mesh>

      <mesh position={[0, 0.72, 0.86]} rotation={[-0.28, 0, 0]}>
        <boxGeometry args={[0.62, 0.34, 0.02]} />
        <meshStandardMaterial color="#D9B36A" roughness={0.32} metalness={0.9} />
      </mesh>
    </group>
  );
}
