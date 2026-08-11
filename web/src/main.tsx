import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type ConnectionState = "connecting" | "connected" | "disconnected";
type ControlMode = "manual" | "music";
type SendBrightness = (brightness: number) => boolean;

interface MusicSettings {
  kickWeight: number;
  snareWeight: number;
  hatWeight: number;
  threshold: number;
  minimumHitInterval: number;
  attack: number;
  release: number;
  minimum: number;
  maximum: number;
  updateRate: number;
}

interface MusicMetrics {
  brightness: number;
  flux: number;
  threshold: number;
  level: number;
  hit: boolean;
}

interface PlaylistTrack {
  id: string;
  name: string;
  url: string;
}

const MAX_BRIGHTNESS = 1000;
const DEFAULT_SETTINGS: MusicSettings = {
  kickWeight: 1.4,
  snareWeight: 1,
  hatWeight: 0.8,
  threshold: 1.8,
  minimumHitInterval: 80,
  attack: 20,
  release: 250,
  minimum: 0,
  maximum: MAX_BRIGHTNESS,
  updateRate: 25,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function useLightSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [brightness, setBrightness] = useState(0);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    let disposed = false;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      setConnection("connecting");

      socket.addEventListener("open", () => {
        if (disposed || socketRef.current !== socket) return;
        setConnection("connected");
        setServerError("");
        socket.send("get");
      });

      socket.addEventListener("message", (event) => {
        if (socketRef.current !== socket) return;
        const response = String(event.data).trim();
        const valueMatch = response.match(/^(?:get|set)=(\d+)$/);

        if (valueMatch) {
          setBrightness(clamp(Number(valueMatch[1] ?? 0), 0, MAX_BRIGHTNESS));
          setServerError("");
        } else if (response.startsWith("err=")) {
          setServerError(response.slice(4));
        }
      });

      socket.addEventListener("close", () => {
        if (disposed || socketRef.current !== socket) return;
        setConnection("disconnected");
        reconnectTimerRef.current = window.setTimeout(connect, 1500);
      });

      socket.addEventListener("error", () => socket.close());
    }

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
    };
  }, []);

  const sendBrightness = useCallback((nextBrightness: number) => {
    const value = Math.round(clamp(nextBrightness, 0, MAX_BRIGHTNESS));
    setBrightness(value);

    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(`set ${value}`);
    return true;
  }, []);

  return {
    brightness,
    connected: connection === "connected",
    connection,
    sendBrightness,
    serverError,
  };
}

interface ConnectionStatusProps {
  connection: ConnectionState;
  serverError: string;
}

function ConnectionStatus({ connection, serverError }: ConnectionStatusProps) {
  const label =
    connection === "connected"
      ? "Connected"
      : connection === "connecting"
        ? "Connecting…"
        : "Disconnected — retrying…";

  return (
    <div className="connection-area" aria-live="polite">
      <p className={`status status--${connection}`}>
        <span className="status__dot" aria-hidden="true" />
        {label}
      </p>
      {serverError && <p className="server-error">{serverError}</p>}
    </div>
  );
}

interface BrightnessMeterProps {
  value: number;
  label?: string;
}

function BrightnessMeter({ value, label = "Tree brightness" }: BrightnessMeterProps) {
  const percentage = (value / MAX_BRIGHTNESS) * 100;

  return (
    <div className="meter" aria-label={`${label}: ${value} of ${MAX_BRIGHTNESS}`}>
      <div className="meter__labels">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="meter__track">
        <div className="meter__fill" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

interface RangeFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

function RangeField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue = (nextValue) => String(nextValue),
  disabled = false,
}: RangeFieldProps) {
  return (
    <div className="range-field">
      <div className="range-field__heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{formatValue(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

interface ManualPanelProps {
  active: boolean;
  brightness: number;
  connected: boolean;
  sendBrightness: SendBrightness;
}

function ManualPanel({
  active,
  brightness,
  connected,
  sendBrightness,
}: ManualPanelProps) {
  return (
    <section
      id="manual-panel"
      className="panel"
      role="tabpanel"
      aria-labelledby="manual-tab"
      hidden={!active}
    >
      <p className="panel__intro">Set a steady brightness directly.</p>
      <BrightnessMeter value={brightness} />
      <RangeField
        id="manual-brightness"
        label="Brightness"
        value={brightness}
        min={0}
        max={MAX_BRIGHTNESS}
        step={1}
        disabled={!connected}
        onChange={sendBrightness}
        formatValue={(value) => `${value} / ${MAX_BRIGHTNESS}`}
      />
      <div className="range-scale" aria-hidden="true">
        <span>Off</span>
        <span>Full</span>
      </div>
    </section>
  );
}

interface MusicPanelProps {
  active: boolean;
  connected: boolean;
  sendBrightness: SendBrightness;
}

function MusicPanel({ active, connected, sendBrightness }: MusicPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const spectrumRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const previousSpectrumRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const animationRef = useRef<number | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const trackSequenceRef = useRef(0);
  const autoPlayNextRef = useRef(false);
  const settingsRef = useRef<MusicSettings>(DEFAULT_SETTINGS);
  const envelopeRef = useRef(0);
  const adaptiveFluxRef = useRef(0);
  const hasSpectrumRef = useRef(false);
  const lastHitRef = useRef(Number.NEGATIVE_INFINITY);
  const hitLevelRef = useRef(0);
  const hitHoldUntilRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const lastSendRef = useRef(0);
  const lastBrightnessSentRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);

  const [playlist, setPlaylist] = useState<PlaylistTrack[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [settings, setSettings] = useState<MusicSettings>(DEFAULT_SETTINGS);
  const [metrics, setMetrics] = useState<MusicMetrics>({
    brightness: 0,
    flux: 0,
    threshold: 0,
    level: 0,
    hit: false,
  });
  const currentTrack = playlist.find((track) => track.id === currentTrackId) ?? null;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const stopAnalysis = useCallback(
    (turnOff: boolean) => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      envelopeRef.current = 0;
      adaptiveFluxRef.current = 0;
      hasSpectrumRef.current = false;
      lastHitRef.current = Number.NEGATIVE_INFINITY;
      hitLevelRef.current = 0;
      hitHoldUntilRef.current = 0;
      lastFrameRef.current = 0;
      lastBrightnessSentRef.current = null;
      setMetrics({ brightness: 0, flux: 0, threshold: 0, level: 0, hit: false });

      if (turnOff) sendBrightness(0);
    },
    [sendBrightness],
  );

  const ensureAudioGraph = useCallback(async (): Promise<boolean> => {
    if (!audioRef.current) return false;

    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("This browser does not support the Web Audio API.");
      }

      const context = new AudioContextClass();
      const source = context.createMediaElementSource(audioRef.current);
      const analyser = context.createAnalyser();

      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -10;

      source.connect(context.destination);
      source.connect(analyser);

      audioContextRef.current = context;
      analyserRef.current = analyser;
      spectrumRef.current = new Float32Array(analyser.frequencyBinCount);
      previousSpectrumRef.current = new Float32Array(analyser.frequencyBinCount);
    }

    const context = audioContextRef.current;
    if (context?.state === "suspended") {
      await context.resume();
    }

    return true;
  }, []);

  const startAnalysis = useCallback(async () => {
    if (!active || !audioRef.current || audioRef.current.paused) return;

    try {
      await ensureAudioGraph();
      setAudioError("");
    } catch (error) {
      audioRef.current?.pause();
      setAudioError(error instanceof Error ? error.message : "Unable to analyze this audio file.");
      return;
    }

    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
    }

    lastFrameRef.current = performance.now();
    lastUiUpdateRef.current = 0;
    lastSendRef.current = 0;

    function analyze(now: number) {
      const audio = audioRef.current;
      const analyser = analyserRef.current;
      const spectrum = spectrumRef.current;
      const previousSpectrum = previousSpectrumRef.current;

      if (
        !active ||
        !audio ||
        audio.paused ||
        audio.ended ||
        !analyser ||
        !spectrum ||
        !previousSpectrum
      ) {
        animationRef.current = null;
        return;
      }

      analyser.getFloatFrequencyData(spectrum);
      const parameters = settingsRef.current;
      const binWidth = audioContextRef.current!.sampleRate / analyser.fftSize;
      let kickFlux = 0;
      let snareFlux = 0;
      let hatFlux = 0;
      let kickBins = 0;
      let snareBins = 0;
      let hatBins = 0;

      for (let bin = 0; bin < spectrum.length; bin += 1) {
        const decibels = spectrum[bin] ?? analyser.minDecibels;
        const magnitude = Number.isFinite(decibels) ? 10 ** (decibels / 20) : 0;
        const increase = hasSpectrumRef.current
          ? Math.max(0, magnitude - (previousSpectrum[bin] ?? 0))
          : 0;
        const frequency = bin * binWidth;

        if (frequency >= 40 && frequency < 180) {
          kickFlux += increase;
          kickBins += 1;
        } else if (frequency < 4000) {
          snareFlux += increase;
          snareBins += 1;
        } else if (frequency < 12000) {
          hatFlux += increase;
          hatBins += 1;
        }

        previousSpectrum[bin] = magnitude;
      }

      const weightedFlux =
        (kickFlux / Math.max(kickBins, 1)) * parameters.kickWeight +
        (snareFlux / Math.max(snareBins, 1)) * parameters.snareWeight +
        (hatFlux / Math.max(hatBins, 1)) * parameters.hatWeight;

      if (!hasSpectrumRef.current) {
        hasSpectrumRef.current = true;
        adaptiveFluxRef.current = weightedFlux;
      }

      const elapsedSeconds = clamp((now - lastFrameRef.current) / 1000, 0, 0.25);
      const adaptiveRate = 1 - Math.exp(-elapsedSeconds / 0.5);
      adaptiveFluxRef.current +=
        (weightedFlux - adaptiveFluxRef.current) * adaptiveRate;
      const onsetThreshold = Math.max(adaptiveFluxRef.current * parameters.threshold, 0.000001);
      const canTrigger = now - lastHitRef.current >= parameters.minimumHitInterval;
      const hit = canTrigger && weightedFlux > onsetThreshold;

      if (hit) {
        lastHitRef.current = now;
        const onsetRatio = weightedFlux / onsetThreshold;
        hitLevelRef.current = clamp(0.2 + (onsetRatio - 1) / 2.5, 0, 1);
        hitHoldUntilRef.current = now + Math.min(parameters.minimumHitInterval, 50);
      }

      const targetLevel = now < hitHoldUntilRef.current ? hitLevelRef.current : 0;
      const timeConstant =
        targetLevel > envelopeRef.current ? parameters.attack : parameters.release;
      const smoothing = 1 - Math.exp(-elapsedSeconds / Math.max(timeConstant / 1000, 0.001));

      envelopeRef.current += (targetLevel - envelopeRef.current) * smoothing;
      lastFrameRef.current = now;

      const brightness = Math.round(
        parameters.minimum +
          envelopeRef.current * (parameters.maximum - parameters.minimum),
      );

      if (now - lastUiUpdateRef.current >= 40) {
        setMetrics({
          brightness,
          flux: weightedFlux,
          threshold: onsetThreshold,
          level: envelopeRef.current,
          hit,
        });
        lastUiUpdateRef.current = now;
      }

      const sendInterval = 1000 / parameters.updateRate;
      if (
        now - lastSendRef.current >= sendInterval &&
        brightness !== lastBrightnessSentRef.current
      ) {
        sendBrightness(brightness);
        lastBrightnessSentRef.current = brightness;
        lastSendRef.current = now;
      }

      animationRef.current = window.requestAnimationFrame(analyze);
    }

    animationRef.current = window.requestAnimationFrame(analyze);
  }, [active, ensureAudioGraph, sendBrightness]);

  useEffect(() => {
    if (!active) {
      audioRef.current?.pause();
      stopAnalysis(false);
    }
  }, [active, stopAnalysis]);

  useEffect(() => {
    if (connected && active) lastBrightnessSentRef.current = null;
  }, [active, connected]);

  useEffect(() => {
    if (!autoPlayNextRef.current || !currentTrack) return;
    autoPlayNextRef.current = false;

    void audioRef.current?.play().catch((error: unknown) => {
      setAudioError(error instanceof Error ? error.message : "Unable to play the next track.");
    });
  }, [currentTrack]);

  useEffect(
    () => () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
      audioRef.current?.pause();
      void audioContextRef.current?.close();
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();
    },
    [],
  );

  function isMp3(file: File) {
    return file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3");
  }

  function addFiles(files: Iterable<File>) {
    const candidates = Array.from(files);
    const accepted = candidates.filter(isMp3);
    const rejectedCount = candidates.length - accepted.length;

    if (accepted.length === 0) {
      setAudioError("Drop or choose one or more MP3 audio files.");
      return;
    }

    const newTracks = accepted.map((file): PlaylistTrack => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      trackSequenceRef.current += 1;
      return {
        id: `track-${Date.now()}-${trackSequenceRef.current}`,
        name: file.name,
        url,
      };
    });

    setPlaylist((current) => [...current, ...newTracks]);
    setCurrentTrackId((current) => current ?? newTracks[0]?.id ?? null);
    setAudioError(rejectedCount > 0 ? `${rejectedCount} non-MP3 file(s) were skipped.` : "");
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.currentTarget.value = "";
  }

  function selectTrack(trackId: string) {
    if (trackId === currentTrackId) return;
    audioRef.current?.pause();
    stopAnalysis(true);
    setCurrentTrackId(trackId);
    setAudioError("");
  }

  function removeTrack(trackId: string) {
    const trackIndex = playlist.findIndex((track) => track.id === trackId);
    if (trackIndex < 0) return;

    const track = playlist[trackIndex];
    if (!track) return;

    const remaining = playlist.filter((item) => item.id !== trackId);
    if (trackId === currentTrackId) {
      audioRef.current?.pause();
      stopAnalysis(true);
      const nextIndex = Math.min(trackIndex, remaining.length - 1);
      setCurrentTrackId(nextIndex >= 0 ? remaining[nextIndex]?.id ?? null : null);
    }

    URL.revokeObjectURL(track.url);
    objectUrlsRef.current.delete(track.url);
    setPlaylist(remaining);
  }

  function advancePlaylist() {
    stopAnalysis(true);
    const currentIndex = playlist.findIndex((track) => track.id === currentTrackId);
    const nextTrack = playlist[currentIndex + 1];
    if (!nextTrack) return;

    autoPlayNextRef.current = true;
    setCurrentTrackId(nextTrack.id);
  }

  function enterDropZone(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function leaveDropZone(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function dragOverDropZone(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);

    addFiles(event.dataTransfer.files);
  }

  function updateSetting<Key extends keyof MusicSettings>(
    name: Key,
    value: MusicSettings[Key],
  ) {
    setSettings((current) => ({ ...current, [name]: value }));
  }

  return (
    <section
      id="music-panel"
      className="panel"
      role="tabpanel"
      aria-labelledby="music-tab"
      hidden={!active}
    >
      <p className="panel__intro">
        Detect kick, snare, and hi-hat transients locally and pulse the tree on each hit.
      </p>

      <div
        className={`file-drop${isDragging ? " file-drop--active" : ""}`}
        onDragEnter={enterDropZone}
        onDragLeave={leaveDropZone}
        onDragOver={dragOverDropZone}
        onDrop={dropFile}
      >
        <label className="file-drop__label" htmlFor="audio-file">
          <input
            id="audio-file"
            type="file"
            accept=".mp3,audio/mpeg"
            multiple
            onChange={selectFile}
          />
          <span className="file-drop__icon" aria-hidden="true">♪</span>
          <span className="file-drop__copy">
            <strong>{isDragging ? "Drop MP3s here" : "Drag and drop MP3s"}</strong>
            <span>or click to add files to the playlist</span>
          </span>
        </label>
        <span className="file-note">MP3 files stay on this device</span>
      </div>

      <div className="playlist" aria-label="MP3 playlist">
        <div className="playlist__heading">
          <h2>Playlist</h2>
          <span>{playlist.length} {playlist.length === 1 ? "track" : "tracks"}</span>
        </div>
        {playlist.length === 0 ? (
          <p className="playlist__empty">Add MP3 files to begin.</p>
        ) : (
          <ol className="playlist__tracks">
            {playlist.map((track, index) => (
              <li
                key={track.id}
                className={track.id === currentTrackId ? "playlist__track playlist__track--active" : "playlist__track"}
              >
                <button
                  type="button"
                  className="playlist__select"
                  aria-current={track.id === currentTrackId ? "true" : undefined}
                  onClick={() => selectTrack(track.id)}
                >
                  <span className="playlist__number">{index + 1}</span>
                  <span className="playlist__name" title={track.name}>{track.name}</span>
                </button>
                <button
                  type="button"
                  className="playlist__remove"
                  aria-label={`Remove ${track.name}`}
                  title="Remove from playlist"
                  onClick={() => removeTrack(track.id)}
                >
                  −
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <audio
        ref={audioRef}
        className="audio-player"
        src={currentTrack?.url ?? ""}
        controls
        preload="metadata"
        onPlay={() => void startAnalysis()}
        onPause={() => stopAnalysis(active)}
        onEnded={advancePlaylist}
        onError={() => setAudioError("The selected audio file could not be played.")}
      />

      {audioError && <p className="audio-error">{audioError}</p>}

      <div className="analysis-card">
        <BrightnessMeter value={metrics.brightness} label="Music brightness" />
        <div className="analysis-stats">
          <span>Onset flux <strong>{metrics.flux.toExponential(2)}</strong></span>
          <span>Threshold <strong>{metrics.threshold.toExponential(2)}</strong></span>
          <span>Envelope <strong>{Math.round(metrics.level * 100)}%</strong></span>
          <span>Drum hit <strong>{metrics.hit ? "Yes" : "—"}</strong></span>
        </div>
      </div>

      <details className="settings" open>
        <summary>Drum response</summary>
        <div className="settings__grid">
          <RangeField
            id="kick-weight"
            label="Kick weight (40–180 Hz)"
            value={settings.kickWeight}
            min={0}
            max={3}
            step={0.1}
            onChange={(value) => updateSetting("kickWeight", value)}
            formatValue={(value) => `${value.toFixed(1)}×`}
          />
          <RangeField
            id="snare-weight"
            label="Snare weight (180 Hz–4 kHz)"
            value={settings.snareWeight}
            min={0}
            max={3}
            step={0.1}
            onChange={(value) => updateSetting("snareWeight", value)}
            formatValue={(value) => `${value.toFixed(1)}×`}
          />
          <RangeField
            id="hat-weight"
            label="Hi-hat weight (4–12 kHz)"
            value={settings.hatWeight}
            min={0}
            max={3}
            step={0.1}
            onChange={(value) => updateSetting("hatWeight", value)}
            formatValue={(value) => `${value.toFixed(1)}×`}
          />
          <RangeField
            id="onset-threshold"
            label="Onset threshold"
            value={settings.threshold}
            min={1.1}
            max={4}
            step={0.1}
            onChange={(value) => updateSetting("threshold", value)}
            formatValue={(value) => `${value.toFixed(1)}× average`}
          />
          <RangeField
            id="minimum-hit-interval"
            label="Minimum hit interval"
            value={settings.minimumHitInterval}
            min={30}
            max={300}
            step={5}
            onChange={(value) => updateSetting("minimumHitInterval", value)}
            formatValue={(value) => `${value} ms`}
          />
          <RangeField
            id="attack"
            label="Attack"
            value={settings.attack}
            min={5}
            max={500}
            step={5}
            onChange={(value) => updateSetting("attack", value)}
            formatValue={(value) => `${value} ms`}
          />
          <RangeField
            id="release"
            label="Release"
            value={settings.release}
            min={20}
            max={1500}
            step={10}
            onChange={(value) => updateSetting("release", value)}
            formatValue={(value) => `${value} ms`}
          />
          <RangeField
            id="minimum-brightness"
            label="Minimum brightness"
            value={settings.minimum}
            min={0}
            max={settings.maximum}
            step={1}
            onChange={(value) => updateSetting("minimum", value)}
          />
          <RangeField
            id="maximum-brightness"
            label="Maximum brightness"
            value={settings.maximum}
            min={settings.minimum}
            max={MAX_BRIGHTNESS}
            step={1}
            onChange={(value) => updateSetting("maximum", value)}
          />
          <RangeField
            id="update-rate"
            label="Light update rate"
            value={settings.updateRate}
            min={5}
            max={60}
            step={1}
            onChange={(value) => updateSetting("updateRate", value)}
            formatValue={(value) => `${value} Hz`}
          />
        </div>
      </details>
    </section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<ControlMode>("manual");
  const { brightness, connected, connection, sendBrightness, serverError } =
    useLightSocket();

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Raspberry Pi PWM</p>
          <h1>Light Tree</h1>
        </div>
        <ConnectionStatus connection={connection} serverError={serverError} />
      </header>

      <div className="tabs" role="tablist" aria-label="Light control mode">
        <button
          id="manual-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "manual"}
          aria-controls="manual-panel"
          tabIndex={activeTab === "manual" ? 0 : -1}
          onClick={() => setActiveTab("manual")}
        >
          Manual
        </button>
        <button
          id="music-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "music"}
          aria-controls="music-panel"
          tabIndex={activeTab === "music" ? 0 : -1}
          onClick={() => setActiveTab("music")}
        >
          Music
        </button>
      </div>

      <ManualPanel
        active={activeTab === "manual"}
        brightness={brightness}
        connected={connected}
        sendBrightness={sendBrightness}
      />
      <MusicPanel
        active={activeTab === "music"}
        connected={connected}
        sendBrightness={sendBrightness}
      />
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing React root element");

createRoot(rootElement).render(<App />);
