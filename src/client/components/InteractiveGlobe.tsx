import { Button } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { LAND_POINTS } from "../data/land-points";
import type { GlobeMarker } from "./globe-model";

interface InteractiveGlobeProps {
  markers: GlobeMarker[];
  description: string;
  compact: boolean;
  onReady: () => void;
  onUnsupported: () => void;
}

const DEGREES = Math.PI / 180;
const INITIAL_ROTATION_X = 8 * DEGREES;
const INITIAL_ROTATION_Y = 35 * DEGREES;
const GLOBE_TILT = -5 * DEGREES;

function globePosition(
  latitude: number,
  longitude: number,
  radius: number,
): THREE.Vector3 {
  const latitudeRadians = latitude * DEGREES;
  const longitudeRadians = longitude * DEGREES;
  const latitudeRadius = Math.cos(latitudeRadians) * radius;
  return new THREE.Vector3(
    latitudeRadius * Math.sin(longitudeRadians),
    Math.sin(latitudeRadians) * radius,
    latitudeRadius * Math.cos(longitudeRadians),
  );
}

function createLandGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(LAND_POINTS.length * 3);
  LAND_POINTS.forEach(([latitude, longitude], index) => {
    const point = globePosition(latitude, longitude, 1.012);
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function createGridGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const addSegment = (start: THREE.Vector3, end: THREE.Vector3) => {
    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  };

  for (let latitude = -75; latitude <= 75; latitude += 15) {
    for (let longitude = -180; longitude < 180; longitude += 4) {
      addSegment(
        globePosition(latitude, longitude, 1.006),
        globePosition(latitude, longitude + 4, 1.006),
      );
    }
  }
  for (let longitude = -180; longitude < 180; longitude += 15) {
    for (let latitude = -90; latitude < 90; latitude += 4) {
      addSegment(
        globePosition(latitude, longitude, 1.006),
        globePosition(Math.min(90, latitude + 4), longitude, 1.006),
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return geometry;
}

function createOutlineGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 128; index += 1) {
    const angle = (index / 128) * Math.PI * 2;
    points.push(
      new THREE.Vector3(Math.cos(angle) * 1.007, Math.sin(angle) * 1.007, 0),
    );
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

export function InteractiveGlobe({
  markers,
  description,
  compact,
  onReady,
  onUnsupported,
}: InteractiveGlobeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenCountRef = useRef<HTMLSpanElement>(null);
  const markerElements = useRef(new Map<string, HTMLDivElement>());
  const markersRef = useRef(markers);
  const renderRef = useRef<() => void>(() => undefined);
  const resetRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.warn(
        "Interactive globe unavailable; using static fallback",
        error,
      );
      onUnsupported();
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = GLOBE_TILT;
    scene.add(tiltGroup);

    const globe = new THREE.Group();
    globe.rotation.order = "YXZ";
    tiltGroup.add(globe);

    const sphereGeometry = new THREE.SphereGeometry(1, 64, 40);
    const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xfffbf5 });
    globe.add(new THREE.Mesh(sphereGeometry, sphereMaterial));

    const gridGeometry = createGridGeometry();
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0xd97745,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    globe.add(new THREE.LineSegments(gridGeometry, gridMaterial));

    const landGeometry = createLandGeometry();
    const landUniforms = {
      pointColor: { value: new THREE.Color(0xf04418) },
      pointSize: { value: 1.2 },
      pixelRatio: { value: renderer.getPixelRatio() },
    };
    const landMaterial = new THREE.ShaderMaterial({
      uniforms: landUniforms,
      vertexShader: `
        uniform float pointSize;
        uniform float pixelRatio;
        varying float facing;

        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vec3 viewNormal = normalize(normalMatrix * normalize(position));
          facing = viewNormal.z;
          gl_PointSize = max(1.0, pointSize * pixelRatio * (4.0 / -viewPosition.z));
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 pointColor;
        varying float facing;

        void main() {
          if (facing <= 0.0) discard;
          float edgeFade = smoothstep(0.0, 0.42, facing);
          gl_FragColor = vec4(pointColor, mix(0.08, 0.98, edgeFade));
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    globe.add(new THREE.Points(landGeometry, landMaterial));

    const outlineGeometry = createOutlineGeometry();
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0xd97745,
      transparent: true,
      opacity: 0.2,
    });
    scene.add(new THREE.LineLoop(outlineGeometry, outlineMaterial));

    let rotationX = INITIAL_ROTATION_X;
    let rotationY = INITIAL_ROTATION_Y;
    let pointerId: number | undefined;
    let previousX = 0;
    let previousY = 0;

    const setRotation = () => {
      globe.rotation.x = rotationX;
      globe.rotation.y = rotationY;
      globe.updateWorldMatrix(true, true);
    };

    const placeMarkers = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      let hidden = 0;
      for (const marker of markersRef.current) {
        const element = markerElements.current.get(marker.id);
        if (!element) continue;
        const position = globePosition(
          marker.latitude,
          marker.longitude,
          1.075,
        ).applyMatrix4(globe.matrixWorld);
        const facing = position.z;
        if (facing <= 0.08) {
          element.style.opacity = "0";
          element.style.visibility = "hidden";
          hidden += 1;
          continue;
        }
        const projected = position.clone().project(camera);
        element.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
        element.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
        element.style.opacity = String(
          Math.min(1, Math.max(0.25, facing * 1.8)),
        );
        element.style.visibility = "visible";
      }
      if (hiddenCountRef.current) {
        hiddenCountRef.current.textContent =
          hidden > 0
            ? `${hidden} marker${hidden === 1 ? "" : "s"} on far side`
            : "All markers visible";
      }
    };

    const render = () => {
      setRotation();
      renderer.render(scene, camera);
      placeMarkers();
    };
    renderRef.current = render;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      landUniforms.pixelRatio.value = renderer.getPixelRatio();
      render();
    };

    const applyTheme = () => {
      const dark = document.documentElement.dataset.mode === "dark";
      sphereMaterial.color.set(dark ? 0x101010 : 0xfffbf5);
      gridMaterial.color.set(dark ? 0x8c321d : 0xd97745);
      gridMaterial.opacity = dark ? 0.14 : 0.16;
      outlineMaterial.color.set(dark ? 0x8c321d : 0xd97745);
      landUniforms.pointColor.value.set(dark ? 0xff4f1f : 0xf04418);
      render();
    };

    const reset = () => {
      rotationX = INITIAL_ROTATION_X;
      rotationY = INITIAL_ROTATION_Y;
      render();
      canvas.focus({ preventScroll: true });
    };
    resetRef.current = reset;

    const onPointerDown = (event: PointerEvent) => {
      pointerId = event.pointerId;
      previousX = event.clientX;
      previousY = event.clientY;
      canvas.setPointerCapture(pointerId);
      canvas.classList.add("is-dragging");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const deltaX = event.clientX - previousX;
      const deltaY = event.clientY - previousY;
      previousX = event.clientX;
      previousY = event.clientY;
      rotationY += deltaX * 0.006;
      rotationX = THREE.MathUtils.clamp(
        rotationX + deltaY * 0.0045,
        -Math.PI * 0.42,
        Math.PI * 0.42,
      );
      render();
    };
    const releasePointer = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      pointerId = undefined;
      canvas.classList.remove("is-dragging");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const rotationStep = event.shiftKey ? 12 * DEGREES : 5 * DEGREES;
      if (event.key === "ArrowLeft") rotationY -= rotationStep;
      else if (event.key === "ArrowRight") rotationY += rotationStep;
      else if (event.key === "ArrowUp")
        rotationX = Math.max(-Math.PI * 0.42, rotationX - rotationStep);
      else if (event.key === "ArrowDown")
        rotationX = Math.min(Math.PI * 0.42, rotationX + rotationStep);
      else if (event.key === "Home") {
        reset();
        return;
      } else return;
      event.preventDefault();
      render();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    canvas.addEventListener("keydown", onKeyDown);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"],
    });

    resize();
    applyTheme();
    const readyFrame = requestAnimationFrame(onReady);

    return () => {
      cancelAnimationFrame(readyFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", releasePointer);
      canvas.removeEventListener("pointercancel", releasePointer);
      canvas.removeEventListener("keydown", onKeyDown);
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      landGeometry.dispose();
      landMaterial.dispose();
      outlineGeometry.dispose();
      outlineMaterial.dispose();
      renderer.dispose();
      renderRef.current = () => undefined;
      resetRef.current = () => undefined;
    };
  }, [onReady, onUnsupported]);

  useEffect(() => {
    markersRef.current = markers;
    renderRef.current();
  }, [markers]);

  return (
    <div ref={hostRef} className="interactive-globe">
      <canvas
        ref={canvasRef}
        className="interactive-globe-canvas"
        tabIndex={0}
        aria-label={`Interactive regional generator globe. ${description}. Drag with a mouse or touch, use arrow keys to rotate, and press Home to reset.`}
      />
      <div className="globe-marker-layer" aria-hidden="true">
        {markers.map((marker) => (
          <div
            key={marker.id}
            ref={(element) => {
              if (element) markerElements.current.set(marker.id, element);
              else markerElements.current.delete(marker.id);
            }}
            className={`globe-marker globe-marker-${marker.status}`}
            title={`${marker.label}${marker.locations.length > 0 ? ` · ${marker.locations.join(", ")}` : ""}`}
          >
            <span className="globe-marker-pin" />
            {!compact && <strong>{marker.displayCode}</strong>}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="globe-interaction-hint" aria-hidden="true">
          <span>Drag to rotate · arrow keys</span>
          <span ref={hiddenCountRef} />
        </div>
      )}
      <div className="globe-reset-control">
        <Button
          variant="secondary"
          size="sm"
          shape="square"
          icon={ArrowCounterClockwiseIcon}
          aria-label="Reset globe view"
          title="Reset globe view"
          onClick={() => resetRef.current()}
        />
      </div>
    </div>
  );
}
