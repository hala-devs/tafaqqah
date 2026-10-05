/**
 * Local microphone recorder for «حفظ المتن» — framework-free so its whole lifecycle is unit-tested.
 *
 * PRIVACY (verified by tests/memorization-privacy.test.ts): the recording is a Blob that lives only in this browser
 * tab. It is played back through URL.createObjectURL and revoked when discarded or when the page ends. There is no
 * upload, no FormData, no server action, no database field, no transcription and no AI call anywhere near it.
 */

export type RecorderState = "IDLE" | "REQUESTING_PERMISSION" | "RECORDING" | "FINISHED" | "PLAYBACK" | "ERROR";
export type RecorderErrorCode = "UNSUPPORTED" | "PERMISSION_DENIED" | "NO_MICROPHONE" | "RECORDING_FAILED" | "EMPTY_RECORDING";

export const RECORDER_ERROR_MESSAGE: Record<RecorderErrorCode, string> = {
  UNSUPPORTED: "متصفحك لا يدعم تسجيل الصوت. جرّب متصفحًا حديثًا، أو تابع دون تسجيل.",
  PERMISSION_DENIED: "لم يُسمح باستخدام الميكروفون. اسمح به من إعدادات المتصفح ثم أعد المحاولة.",
  NO_MICROPHONE: "لم نجد ميكروفونًا متصلًا. وصّل ميكروفونًا ثم أعد المحاولة.",
  RECORDING_FAILED: "حدث خطأ أثناء التسجيل. أعد المحاولة.",
  EMPTY_RECORDING: "لم يُسجَّل أي صوت. أعد التسميع وتأكد من عمل الميكروفون.",
};

type TrackLike = { stop(): void };
type StreamLike = { getTracks(): TrackLike[] };
type RecorderEventTarget = {
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};
type RecorderCtor = (new (stream: StreamLike, options?: { mimeType?: string }) => RecorderEventTarget) & { isTypeSupported?: (type: string) => boolean };

export type RecorderEnv = {
  getUserMedia?: (constraints: { audio: boolean }) => Promise<StreamLike>;
  MediaRecorder?: RecorderCtor;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  now: () => number;
};

export function browserRecorderEnv(): RecorderEnv {
  const w = globalThis as unknown as {
    navigator?: { mediaDevices?: { getUserMedia?: (c: { audio: boolean }) => Promise<StreamLike> } };
    MediaRecorder?: RecorderCtor;
  };
  const media = w.navigator?.mediaDevices;
  return {
    getUserMedia: media?.getUserMedia ? (c) => media.getUserMedia!(c) : undefined,
    MediaRecorder: w.MediaRecorder,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    now: () => Date.now(),
  };
}

export type RecorderSnapshot = { state: RecorderState; error: RecorderErrorCode | null; url: string | null; startedAt: number | null; durationMs: number };

/** Shortest recording treated as real audio (a tap-and-stop produces no usable recitation). */
export const MIN_RECORDING_MS = 700;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export class RecorderController {
  private snapshot: RecorderSnapshot = { state: "IDLE", error: null, url: null, startedAt: null, durationMs: 0 };
  private listeners = new Set<() => void>();
  private stream: StreamLike | null = null;
  private recorder: RecorderEventTarget | null = null;
  private chunks: Blob[] = [];
  private disposed = false;
  /** Bumped by every start/reset so a late permission result from an abandoned attempt is ignored. */
  private generation = 0;

  constructor(private readonly env: RecorderEnv) {}

  getSnapshot = (): RecorderSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<RecorderSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  get isSupported(): boolean {
    return Boolean(this.env.getUserMedia && this.env.MediaRecorder);
  }

  private releaseStream() {
    for (const track of this.stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        /* already stopped */
      }
    }
    this.stream = null;
  }

  private revokeUrl() {
    if (this.snapshot.url) this.env.revokeObjectURL(this.snapshot.url);
  }

  private fail(error: RecorderErrorCode) {
    this.releaseStream();
    this.recorder = null;
    this.chunks = [];
    this.revokeUrl();
    this.set({ state: "ERROR", error, url: null, startedAt: null, durationMs: 0 });
  }

  /** Asks for the microphone and starts recording. */
  async start(): Promise<void> {
    if (this.disposed) return;
    const state = this.snapshot.state;
    if (state === "REQUESTING_PERMISSION" || state === "RECORDING") return;
    if (!this.env.getUserMedia || !this.env.MediaRecorder) return this.fail("UNSUPPORTED");

    const generation = ++this.generation;
    this.revokeUrl();
    this.chunks = [];
    this.set({ state: "REQUESTING_PERMISSION", error: null, url: null, startedAt: null, durationMs: 0 });

    let stream: StreamLike;
    try {
      stream = await this.env.getUserMedia({ audio: true });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      const name = (error as { name?: string } | null)?.name;
      return this.fail(name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" ? "NO_MICROPHONE" : "PERMISSION_DENIED");
    }
    if (generation !== this.generation || this.disposed) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;

    let recorder: RecorderEventTarget;
    try {
      const Ctor = this.env.MediaRecorder;
      const mimeType = Ctor.isTypeSupported ? MIME_CANDIDATES.find((m) => Ctor.isTypeSupported!(m)) : undefined;
      recorder = new Ctor(stream, mimeType ? { mimeType } : undefined);
    } catch {
      return this.fail("RECORDING_FAILED");
    }
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = () => {
      if (generation === this.generation) this.fail("RECORDING_FAILED");
    };
    recorder.onstop = () => {
      if (generation !== this.generation || this.disposed) return;
      const startedAt = this.snapshot.startedAt ?? this.env.now();
      const durationMs = this.env.now() - startedAt;
      const chunks = this.chunks;
      this.chunks = [];
      this.releaseStream();
      this.recorder = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size === 0 || durationMs < MIN_RECORDING_MS) return this.fail("EMPTY_RECORDING");
      this.set({ state: "FINISHED", url: this.env.createObjectURL(blob), durationMs, error: null });
    };

    try {
      recorder.start(250);
    } catch {
      return this.fail("RECORDING_FAILED");
    }
    this.set({ state: "RECORDING", startedAt: this.env.now() });
  }

  /** Ends the recording; the recorder then reports FINISHED (or ERROR for an empty recording). */
  stop(): void {
    if (this.snapshot.state !== "RECORDING" || !this.recorder) return;
    try {
      this.recorder.stop();
    } catch {
      this.fail("RECORDING_FAILED");
    }
  }

  /** The audio element started / stopped playing. */
  setPlaying(playing: boolean): void {
    if (playing && this.snapshot.state === "FINISHED") this.set({ state: "PLAYBACK" });
    else if (!playing && this.snapshot.state === "PLAYBACK") this.set({ state: "FINISHED" });
  }

  /** Throws the recording away (retry): revokes the object URL and returns to IDLE. */
  reset(): void {
    this.generation += 1;
    this.releaseStream();
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.onstop = null;
        this.recorder.stop();
      }
    } catch {
      /* ignore */
    }
    this.recorder = null;
    this.chunks = [];
    this.revokeUrl();
    this.set({ state: "IDLE", error: null, url: null, startedAt: null, durationMs: 0 });
  }

  /** Re-arms a controller after dispose() (React StrictMode runs mount → unmount → mount on the same instance). */
  activate(): void {
    this.disposed = false;
  }

  /** Component unmount / page end: stop the microphone and revoke the object URL. */
  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.releaseStream();
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.onstop = null;
        this.recorder.stop();
      }
    } catch {
      /* ignore */
    }
    this.recorder = null;
    this.chunks = [];
    this.revokeUrl();
    this.snapshot = { ...this.snapshot, url: null };
    this.listeners.clear();
  }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
