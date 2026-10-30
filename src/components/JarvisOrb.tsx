"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbActivity, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";

type CameraState = "off" | "starting" | "on" | "error";
export type OrbMode = "orb" | "assist";

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

const ACTIVITY_LABEL: Record<OrbActivity, string> = {
  idle: "STANDBY",
  connecting: "PROCESSING",
  executing: "EXECUTING",
  speaking: "RESPONDING",
};

export interface JarvisOrbProps {
  /** Real connection state driving the orb visuals. */
  activity: OrbActivity;
  /** Dual mode: immersive orb vs assistant console. */
  mode: OrbMode;
  onToggleMode: () => void;
}

export default function JarvisOrb({
  activity,
  mode,
  onToggleMode,
}: JarvisOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createOrbScene(container);
    sceneRef.current = scene;
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Drive the orb from REAL backend connection state.
  useEffect(() => {
    sceneRef.current?.setActivity(activity);
  }, [activity]);

  // Session uptime readout (real elapsed time).
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      setUptime(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setError(null);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: setStatus,
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED",
      );
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never hijack typing in the assistant console.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
        case "a":
        case "A":
          onToggleMode();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures, onToggleMode]);

  const cameraOn = camera === "on";
  const assistOpen = mode === "assist";
  /**
   * PHASE 10 (Playbook §13.2): Orb Mode contains EXACTLY the orb scene +
   * ONE small bottom switch. Every other HUD element (title, status
   * readout, hints, camera preview, controls) is rendered ONLY in Text
   * Mode. The camera stream stays mounted (dormant, invisible) so hand
   * tracking survives mode switches without re-enumerating the camera.
   */
  const showHud = assistOpen;

  const clock = `${String(Math.floor(uptime / 60)).padStart(2, "0")}:${String(
    uptime % 60,
  ).padStart(2, "0")}`;

  return (
    <>
      <div ref={containerRef} className="orb-root" aria-label="JARVIS holographic orb" />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      {showHud && (
        <>
          {/* ——— TOP LEFT: identity (TEXT MODE ONLY) ——— */}
          <div className="hud hud-title">
            J.A.R.V.I.S.
            <span className="hud-subtitle">JUST A RATHER VERY INTELLIGENT SYSTEM</span>
          </div>

          {/* ——— TOP RIGHT: live status readout (TEXT MODE ONLY) ——— */}
          <div className="hud hud-status" role="status" aria-live="polite">
            <div className="status-row">
              <span className="status-k">CORE</span>
              <span className={`status-v status-v--${activity}`}>
                {ACTIVITY_LABEL[activity]}
              </span>
            </div>
            <div className="status-row">
              <span className="status-k">GEST</span>
              <span className="status-v">
                {camera === "on" ? "ACTIVE" : "OFFLINE"}
              </span>
            </div>
            <div className="status-row">
              <span className="status-k">UPTIME</span>
              <span className="status-v">{clock}</span>
            </div>
          </div>
        </>
      )}

      {/* ——— ORB MODE: exactly one small bottom switch ——— */}
      {!assistOpen && (
        <button
          type="button"
          className="hud-switch"
          onClick={onToggleMode}
          aria-label="Open JARVIS console"
        >
          CONSOLE
        </button>
      )}

      {/* ——— Camera preview: ALWAYS MOUNTED so live gesture tracking
          survives mode switches (the tracker holds these element refs).
          Invisible in Orb Mode via class, visible only in Text Mode. ——— */}
      <div
        className={`camera-panel${cameraOn ? " visible" : ""}${
          assistOpen ? "" : " camera-panel--orb"
        }`}
      >
        {/* Mirrored preview so it behaves like a mirror */}
        <video ref={videoRef} muted playsInline className="camera-video" />
        <canvas ref={overlayRef} width={208} height={156} className="camera-overlay" />
        {assistOpen && (
          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${MODE_LABEL[status.mode]}`
              : "SHOW HANDS"}
          </div>
        )}
      </div>

      {showHud && (
        <>
          {/* ——— BOTTOM LEFT: hints (TEXT MODE ONLY) ——— */}
          <div className="hud hud-hint">
            <div>
              <span className="key">DRAG</span> spin&nbsp;&nbsp;
              <span className="key">SCROLL</span> zoom
            </div>
            {cameraOn ? (
              <div>
                <span className="key">PINCH + MOVE</span> spin&nbsp;&nbsp;
                <span className="key">PINCH BOTH ± SPREAD</span> zoom
              </div>
            ) : (
              <div>
                <span className="key">A</span> assistant&nbsp;&nbsp;
                <span className="key">G</span> gestures&nbsp;&nbsp;
                <span className="key">R</span> reset&nbsp;&nbsp;
                <span className="key">+/−</span> zoom
              </div>
            )}
          </div>

          {/* ——— BOTTOM RIGHT: configuration controls (TEXT MODE) ——— */}
          <div className="hud hud-controls">
            {error && <div className="hud-error">{error}</div>}

            <div className="hud-row">
              <button
                type="button"
                className="hud-btn hud-btn--wide"
                aria-pressed={assistOpen}
                onClick={onToggleMode}
              >
                CLOSE CONSOLE
              </button>
            </div>
            <div className="hud-row">
              <button
                type="button"
                className="hud-btn"
                aria-pressed={cameraOn}
                onClick={toggleGestures}
                disabled={camera === "starting"}
              >
                {camera === "starting" ? "INITIALIZING…" : cameraOn ? "GESTURES ON" : "GESTURES OFF"}
              </button>
            </div>
            <div className="hud-row">
              <button type="button" className="hud-btn" onClick={() => sceneRef.current?.zoomIn()} aria-label="Zoom in">
                +
              </button>
              <button type="button" className="hud-btn" onClick={() => sceneRef.current?.zoomOut()} aria-label="Zoom out">
                −
              </button>
              <button type="button" className="hud-btn" onClick={() => sceneRef.current?.resetView()}>
                RESET
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
