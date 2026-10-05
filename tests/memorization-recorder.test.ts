import { describe, expect, it } from "vitest";
import { formatClock, MIN_RECORDING_MS, RecorderController, type RecorderEnv, type RecorderState } from "@/lib/recorder";

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

function makeEnv(options: { permission?: "grant" | { name: string }; supported?: boolean; chunk?: number; clock?: { t: number }; startThrows?: boolean } = {}) {
  const clock = options.clock ?? { t: 1000 };
  const tracks: FakeTrack[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  const recorders: FakeRecorder[] = [];

  class FakeRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    static isTypeSupported() {
      return true;
    }
    constructor() {
      recorders.push(this);
    }
    start() {
      if (options.startThrows) throw new Error("boom");
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      const size = options.chunk ?? 1200;
      if (size > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
      this.onstop?.();
    }
  }

  const env: RecorderEnv = {
    getUserMedia:
      options.supported === false
        ? undefined
        : async () => {
            if (options.permission && options.permission !== "grant") throw Object.assign(new Error("denied"), { name: options.permission.name });
            const track = new FakeTrack();
            tracks.push(track);
            return { getTracks: () => [track] };
          },
    MediaRecorder: options.supported === false ? undefined : (FakeRecorder as unknown as RecorderEnv["MediaRecorder"]),
    createObjectURL: () => {
      const url = `blob:local-${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
    now: () => clock.t,
  };
  return { env, clock, tracks, created, revoked, recorders };
}

const states = (c: RecorderController) => {
  const seen: RecorderState[] = [c.getSnapshot().state];
  c.subscribe(() => seen.push(c.getSnapshot().state));
  return seen;
};

describe("local recorder lifecycle", () => {
  it("IDLE → REQUESTING_PERMISSION → RECORDING → FINISHED, producing a local object URL", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    const seen = states(c);
    const starting = c.start();
    expect(c.getSnapshot().state).toBe("REQUESTING_PERMISSION");
    await starting;
    expect(c.getSnapshot().state).toBe("RECORDING");
    f.clock.t += 5000;
    c.stop();
    expect(seen.filter((s, i) => s !== seen[i - 1])).toEqual(["IDLE", "REQUESTING_PERMISSION", "RECORDING", "FINISHED"]);
    const snap = c.getSnapshot();
    expect(snap).toMatchObject({ state: "FINISHED", error: null, url: "blob:local-1", durationMs: 5000 });
    expect(f.tracks.every((t) => t.stopped)).toBe(true); // microphone released
  });

  it("playback toggles FINISHED ↔ PLAYBACK", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    await c.start();
    f.clock.t += 2000;
    c.stop();
    c.setPlaying(true);
    expect(c.getSnapshot().state).toBe("PLAYBACK");
    c.setPlaying(false);
    expect(c.getSnapshot().state).toBe("FINISHED");
  });

  it("permission denied → ERROR(PERMISSION_DENIED); retry works once allowed", async () => {
    const denied = makeEnv({ permission: { name: "NotAllowedError" } });
    const c = new RecorderController(denied.env);
    await c.start();
    expect(c.getSnapshot()).toMatchObject({ state: "ERROR", error: "PERMISSION_DENIED", url: null });
    c.reset();
    expect(c.getSnapshot().state).toBe("IDLE");
  });

  it("no microphone → ERROR(NO_MICROPHONE)", async () => {
    const c = new RecorderController(makeEnv({ permission: { name: "NotFoundError" } }).env);
    await c.start();
    expect(c.getSnapshot()).toMatchObject({ state: "ERROR", error: "NO_MICROPHONE" });
  });

  it("MediaRecorder unsupported → ERROR(UNSUPPORTED) without asking for a microphone", async () => {
    const f = makeEnv({ supported: false });
    const c = new RecorderController(f.env);
    expect(c.isSupported).toBe(false);
    await c.start();
    expect(c.getSnapshot()).toMatchObject({ state: "ERROR", error: "UNSUPPORTED" });
    expect(f.tracks).toHaveLength(0);
  });

  it("a recording error while starting → ERROR(RECORDING_FAILED) and the microphone is released", async () => {
    const f = makeEnv({ startThrows: true });
    const c = new RecorderController(f.env);
    await c.start();
    expect(c.getSnapshot()).toMatchObject({ state: "ERROR", error: "RECORDING_FAILED" });
    expect(f.tracks.every((t) => t.stopped)).toBe(true);
  });

  it("an error event during recording → ERROR(RECORDING_FAILED)", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    await c.start();
    f.recorders[0].onerror?.({});
    expect(c.getSnapshot()).toMatchObject({ state: "ERROR", error: "RECORDING_FAILED" });
    expect(f.tracks.every((t) => t.stopped)).toBe(true);
  });

  it("an empty recording (no data) or an instant tap is rejected as EMPTY_RECORDING and creates no URL", async () => {
    const empty = makeEnv({ chunk: 0 });
    const c = new RecorderController(empty.env);
    await c.start();
    empty.clock.t += 4000;
    c.stop();
    expect(c.getSnapshot()).toMatchObject({ state: "ERROR", error: "EMPTY_RECORDING", url: null });
    expect(empty.created).toHaveLength(0);

    const tap = makeEnv();
    const c2 = new RecorderController(tap.env);
    await c2.start();
    tap.clock.t += MIN_RECORDING_MS - 1;
    c2.stop();
    expect(c2.getSnapshot()).toMatchObject({ state: "ERROR", error: "EMPTY_RECORDING" });
    expect(tap.created).toHaveLength(0);
  });

  it("retry: discarding a finished recording revokes its object URL and a new recording gets a new one", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    await c.start();
    f.clock.t += 3000;
    c.stop();
    const first = c.getSnapshot().url;
    c.reset();
    expect(f.revoked).toEqual([first]);
    expect(c.getSnapshot()).toMatchObject({ state: "IDLE", url: null });
    await c.start();
    f.clock.t += 3000;
    c.stop();
    expect(c.getSnapshot().url).not.toBe(first);
    expect(f.created).toHaveLength(2);
  });

  it("starting again from FINISHED revokes the previous URL", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    await c.start();
    f.clock.t += 3000;
    c.stop();
    const first = c.getSnapshot().url!;
    await c.start();
    expect(f.revoked).toContain(first);
  });

  it("unmount (dispose) while recording stops the microphone and never produces a URL", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    await c.start();
    c.dispose();
    expect(f.tracks.every((t) => t.stopped)).toBe(true);
    expect(f.created).toHaveLength(0);
    expect(c.getSnapshot().url).toBeNull();
  });

  it("unmount (dispose) after a recording revokes the object URL", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    await c.start();
    f.clock.t += 3000;
    c.stop();
    const url = c.getSnapshot().url;
    c.dispose();
    expect(f.revoked).toEqual([url]);
  });

  it("unmounting while the permission prompt is open releases the stream that arrives late", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    const starting = c.start();
    c.dispose();
    await starting;
    expect(f.tracks.every((t) => t.stopped)).toBe(true);
    expect(f.recorders).toHaveLength(0);
  });

  it("a double click on start does not request the microphone twice", async () => {
    const f = makeEnv();
    const c = new RecorderController(f.env);
    await Promise.all([c.start(), c.start()]);
    expect(f.tracks).toHaveLength(1);
  });

  it("formats the elapsed clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(42_900)).toBe("00:42");
    expect(formatClock(125_000)).toBe("02:05");
  });
});
