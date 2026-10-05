"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { browserRecorderEnv, RecorderController } from "@/lib/recorder";

/**
 * React binding of the local RecorderController. On unmount the controller is disposed, which stops the microphone and
 * revokes the object URL. Audio never leaves the browser.
 */
export function useRecorder() {
  const [controller] = useState(() => new RecorderController(browserRecorderEnv()));

  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const [now, setNow] = useState(0);
  const recording = snapshot.state === "RECORDING";
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [recording]);

  const elapsedMs = recording && snapshot.startedAt ? Math.max(0, now - snapshot.startedAt) : snapshot.durationMs;

  return {
    ...snapshot,
    elapsedMs,
    ready: true,
    start: useCallback(() => controller.start(), [controller]),
    stop: useCallback(() => controller.stop(), [controller]),
    reset: useCallback(() => controller.reset(), [controller]),
    setPlaying: useCallback((playing: boolean) => controller.setPlaying(playing), [controller]),
  };
}
