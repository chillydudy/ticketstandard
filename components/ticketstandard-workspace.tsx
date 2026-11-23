"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowClockwise, ArrowCounterClockwise, Crop, DownloadSimple, FlipHorizontal, ImageSquare, SlidersHorizontal, Sparkle, Palette } from "@phosphor-icons/react";
import { imagePresets, standardizeImage, validateImageFile, type ImagePreset, type ImageTransform, type OutputFormat, type PhotoAdjustments } from "@/lib/ticketstandard/image-processing";

type WorkerRef = { current: Worker | null };
type FileRef = { current: File | null };

function renderWithWorker(workerRef: WorkerRef, workerFileRef: FileRef, ...args: Parameters<typeof standardizeImage>): ReturnType<typeof standardizeImage> {
  const worker = workerRef.current;
  if (!worker) return standardizeImage(...args);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", done);
      worker.removeEventListener("error", failed);
    };
    const done = (event: MessageEvent) => {
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    const failed = () => {
      cleanup();
      if (workerRef.current === worker) {
        workerRef.current = null;
        worker.terminate();
        standardizeImage(...args).then(resolve, reject);
      } else reject(new Error("Image processing was interrupted."));
    };
    worker.addEventListener("message", done);
    worker.addEventListener("error", failed);
    const [file, ...settings] = args;
    worker.postMessage([workerFileRef.current === file ? null : file, ...settings]);
    workerFileRef.current = file;
  });
}

type Edit = PhotoAdjustments & ImageTransform & { preset: ImagePreset; background: string; filter: (typeof filters)[number]["name"] };
const initial: Edit = { exposure: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, zoom: 1, straighten: 0, panX: 0, panY: 0, rotation: 0, flipHorizontal: false, preset: "original", background: "#f4f2ed", fillMode: "none", filter: "Original" };

function filenameStem(name: string) {
  return name.replace(/\.[^.]+$/, "").trim();
}

function safeFilenameStem(value: string, fallback: string) {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/^\.+|[. ]+$/g, "")
    .replace(/(?:\.(?:jpe?g|png|webp))+$/i, "")
    .trim();
  if (!sanitized) return fallback;
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(sanitized) ? `_${sanitized}` : sanitized;
}

function outputExtension(format: OutputFormat) {
  return format === "image/jpeg" ? "jpg" : format.split("/")[1];
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function getEntryFrame(): Edit {
  const frame = new URLSearchParams(window.location.search).get("frame");
  const preset = imagePresets.find(({ value }) => value === frame)?.value;
  return preset ? { ...initial, preset } : initial;
}
const tabs = [
  { name: "Adjust", Icon: SlidersHorizontal }, { name: "Filters", Icon: Palette },
  { name: "Crop", Icon: Crop }, { name: "Tools", Icon: Sparkle },
] as const;
const filters = [
  { name: "Original", contrast: 0, saturation: 0, warmth: 0 },
  { name: "Vivid", contrast: .15, saturation: .4, warmth: .08 },
  { name: "Warm", contrast: .04, saturation: .12, warmth: .55 },
  { name: "Cool", contrast: .06, saturation: -.08, warmth: -.55 },
  { name: "Mono", contrast: .16, saturation: -1, warmth: 0 },
] as const;

async function inspectPhoto(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = bitmap;
    return { width, height };
  } finally {
    bitmap.close();
  }
}

export function TicketStandardWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<{ url: string; edit: Edit; file: File; format: OutputFormat; draft: boolean; width: number; height: number; bytes: number }>();
  const [outputPreview, setOutputPreview] = useState<{ blob: Blob; edit: Edit; file: File; format: OutputFormat; width: number; height: number; bytes: number }>();
  const [history, setHistory] = useState({ entries: [initial], index: 0 });
  const [saveFormat, setSaveFormat] = useState<OutputFormat>("image/png");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveFilename, setSaveFilename] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saveUpdating, setSaveUpdating] = useState(false);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const saveDialogRef = useRef<HTMLDialogElement>(null);
  const saveFilenameRef = useRef<HTMLInputElement>(null);
  const saveTriggerRef = useRef<HTMLButtonElement>(null);
  const saveStatusTimer = useRef<number | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]["name"]>("Adjust");
  const [compare, setCompare] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [draft, setDraft] = useState<Pick<Edit, "panX" | "panY" | "zoom"> | null>(null);
  const cropDrag = useRef<{ x: number; y: number; width: number; height: number; corner: string | null } | null>(null);

  const [error, setError] = useState("");
  const dragDepth = useRef(0);
  const [isDropping, setIsDropping] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [displayedSource, setDisplayedSource] = useState<string | undefined>();
  const [cloud, setCloud] = useState({ deblur: false, expand: false });
  const [cloudJob, setCloudJob] = useState<"deblur" | null>(null);
  const [cloudResult, setCloudResult] = useState<File | null>(null);
  const cloudRequest = useRef<AbortController | null>(null);
  const [savedEdit, setSavedEdit] = useState<Edit | null>(null);
  const [report, setReport] = useState<{ width: number; height: number }>();
  const edit = history.entries[history.index];
  const straighten = edit.straighten;

  const picker = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ changed: boolean } | null>(null);
  const zoomDrag = useRef<number | null>(null);
  const [zoomDraft, setZoomDraft] = useState<number | null>(null);
  const zoom = zoomDraft ?? edit.zoom;
  const ready = Boolean(preview && preview.file === file && preview.edit === edit && !preview.draft && !adjusting && !draft && zoomDraft === null && !previewUpdating);
  const saveReady = Boolean(outputPreview && outputPreview.file === file && outputPreview.edit === edit && outputPreview.format === saveFormat && !adjusting && !draft && zoomDraft === null && !saveUpdating);
  const openingPhoto = loadingSample || Boolean(source && source !== displayedSource);
  const dirty = Object.keys(initial).some((key) => initial[key as keyof Edit] !== edit[key as keyof Edit]);
  const showOriginal = dirty && compare;
  const cropActive = tab === "Crop" && !showOriginal && !inspect && Boolean(report?.width);
  const quarterTurn = edit.rotation === 90 || edit.rotation === 270;
  const sourceWidth = report?.width || 1;
  const sourceHeight = report?.height || 1;
  const rotatedWidth = quarterTurn ? sourceHeight : sourceWidth;
  const rotatedHeight = quarterTurn ? sourceWidth : sourceHeight;
  const frameWidth = edit.preset === "original" ? rotatedWidth : edit.preset === "landscape" ? 1280 : 1024;
  const frameHeight = edit.preset === "original" ? rotatedHeight : edit.preset === "portrait" ? 1280 : 1024;
  const frameRatio = frameWidth / frameHeight;
  const fit = Math.min(frameWidth / rotatedWidth, frameHeight / rotatedHeight, 1);
  const cropFilter = filters.find(filter => filter.name === edit.filter) ?? filters[0];
  const cropContrast = (1 + edit.contrast) * (1 + cropFilter.contrast);
  const cropSaturation = (1 + edit.saturation) * (1 + cropFilter.saturation);
  const cropExposure = 2 ** edit.exposure;
  const cropWarmth = edit.warmth + cropFilter.warmth;
  const luma = [.2126, .7152, .0722];
  const matrixScale = cropContrast * cropExposure;
  const colorMatrix = [0, 1, 2].flatMap(channel => [0, 1, 2, 0, 0].map((_, column) => {
    if (column === 3) return 0;
    if (column === 4) return (128 - 128 * cropContrast) / 255 + (channel === 0 ? cropWarmth * 35 / 255 : channel === 2 ? -cropWarmth * 35 / 255 : 0);
    return matrixScale * (cropSaturation * (channel === column ? 1 : 0) + (1 - cropSaturation) * luma[column]);
  })).join(" ") + " 0 0 0 1 0";

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([{ contentRect }]) => {
      setStageSize({ width: contentRect.width, height: contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const cropWidth = Math.min(stageSize.width - 24, (stageSize.height - 24) * frameRatio);
  const showCrop = cropActive && cropWidth > 0;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !cropActive) return;
    let pendingZoom: number | null = null;
    let timer = 0;
    function commitZoom() {
      if (pendingZoom === null) return;
      change({ zoom: pendingZoom });
      pendingZoom = null;
      setZoomDraft(null);
    }
    function wheel(event: WheelEvent) {
      if (cropDrag.current || zoomDrag.current !== null) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
      pendingZoom = Math.min(3, Math.max(1, (pendingZoom ?? edit.zoom) * Math.exp(-delta * .0025)));
      setZoomDraft(pendingZoom);
      window.clearTimeout(timer);
      timer = window.setTimeout(commitZoom, 140);
    }
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", wheel);
      window.clearTimeout(timer);
      if (pendingZoom !== null) setZoomDraft(null);
    };
  }, [cropActive, edit.zoom, file]);

  function change(patch: Partial<Edit>, merge = false) {
    setHistory(({ entries, index }) => {
      const next = { ...entries[index], ...patch };
      if (Object.keys(patch).every((key) => next[key as keyof Edit] === entries[index][key as keyof Edit])) return { entries, index };
      const nextIndex = merge && index > 0 ? index : index + 1;
      return { entries: [...entries.slice(0, nextIndex), next], index: nextIndex };
    });
  }

  function load(next?: File) {
    if (!next) return;
    try { validateImageFile(next); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open this photo.");
      return;
    }
    setError("");
    cloudRequest.current?.abort();
    setCloudResult(null);
    setFile(next);
    setSavedEdit(null);
    setSource(URL.createObjectURL(next));
    setReport(undefined);
    setPreview(undefined);
    setCompare(false);
    setInspect(false);
    setDraft(null);
    setHistory({ entries: [getEntryFrame()], index: 0 });
  }

  async function openSample() {
    setLoadingSample(true);
    setError("");
    try {
      const response = await fetch("/images/lego-kit-original-tilted.png");
      if (!response.ok) throw new Error("The sample photo could not load. Try opening your own photo.");
      const blob = await response.blob();
      load(new File([blob], "model-kit.png", { type: "image/png" }));
    } catch {
      setError("The sample photo could not load. Try opening your own photo.");
    } finally {
      setLoadingSample(false);
    }
  }

  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      let ready = false;
      try {
        const response = await fetch("/api/photo-ai", { signal: controller.signal });
        if (response.ok) {
          const value = await response.json();
          ready = Boolean(value.deblur);
          if (active) setCloud(value);
        }
      } catch { /* The local model may still be starting. */ }
      // Keep checking while the local model is offline so the Refine button enables once it starts.
      if (active && !ready) timer = window.setTimeout(() => void refresh(), 4000);
    };
    void refresh();
    return () => { active = false; window.clearTimeout(timer); controller.abort(); cloudRequest.current?.abort(); };
  }, []);

  async function runCloud(tool: "deblur") {
    if (!file || cloudRequest.current) return;
    const controller = new AbortController();
    cloudRequest.current = controller;
    setCloudJob(tool);
    setCloudResult(null);
    setError("");
    try {
      const body = new FormData();
      body.set("image", file);
      body.set("tool", tool);
      const response = await fetch("/api/photo-ai", { method: "POST", body, signal: controller.signal });
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const suffix = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
      setCloudResult(new File([blob], `unblurred.${suffix}`, { type: blob.type }));
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Cloud processing failed.");
    } finally {
      cloudRequest.current = null;
      setCloudJob(null);
    }
  }
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const dialog = saveDialogRef.current;
    if (!dialog) return;
    if (saveOpen) {
      if (!dialog.open) dialog.showModal();
      saveFilenameRef.current?.focus({ preventScroll: true });
      return;
    }
    if (dialog.open) dialog.close();
  }, [saveOpen]);
  useEffect(() => () => {
    if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current);
  }, []);
  useEffect(() => {
    if (!file) return;
    let current = true;
    inspectPhoto(file).then((result) => {
      if (current) setReport(result);
    }).catch(() => {
      if (current) setReport({ width: 0, height: 0 });
    });
    return () => { current = false; };
  }, [file]);
  const workerFile = useRef<File | null>(null);
  const imageWorker = useRef<Worker | null>(null);
  const outputWorkerFile = useRef<File | null>(null);
  const outputWorker = useRef<Worker | null>(null);
  useEffect(() => {
    if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") return;
    const worker = new Worker(new URL("../lib/ticketstandard/image-render.worker.ts", import.meta.url));
    const exportWorker = new Worker(new URL("../lib/ticketstandard/image-render.worker.ts", import.meta.url));
    imageWorker.current = worker;
    outputWorker.current = exportWorker;
    return () => {
      imageWorker.current = null;
      outputWorker.current = null;
      workerFile.current = null;
      outputWorkerFile.current = null;
      worker.dispatchEvent(new Event("error"));
      exportWorker.dispatchEvent(new Event("error"));
      worker.terminate();
      exportWorker.terminate();
    };
  }, []);

  function renderImage(...args: Parameters<typeof standardizeImage>): ReturnType<typeof standardizeImage> {
    return renderWithWorker(imageWorker, workerFile, ...args);
  }
  function renderOutputImage(...args: Parameters<typeof standardizeImage>): ReturnType<typeof standardizeImage> {
    return renderWithWorker(outputWorker, outputWorkerFile, ...args);
  }

  const latestRender = useRef<{ file: File; edit: Edit; adjusting: boolean } | null>(null);
  const rendering = useRef(false);
  useEffect(() => {
    if (!file) return;
    const request = { file, edit, adjusting };
    latestRender.current = request;
    setPreviewUpdating(true);
    async function renderLatest() {
      if (rendering.current) return;
      rendering.current = true;
      try {
        while (latestRender.current) {
          const job = latestRender.current;
          const { file, edit, adjusting } = job;
          const filter = filters.find(({ name }) => name === edit.filter) ?? filters[0];
          const appearance = {
            ...edit,
            contrast: (1 + edit.contrast) * (1 + filter.contrast) - 1,
            saturation: (1 + edit.saturation) * (1 + filter.saturation) - 1,
            warmth: edit.warmth + filter.warmth,
          };
          try {
            const result = await renderImage(file, edit.preset, "image/png", edit.background, edit, appearance, adjusting ? 768 : undefined);
            const latest = latestRender.current;
            if (latest === job) {
              setPreview({ draft: adjusting, url: URL.createObjectURL(result.blob), edit, file, format: "image/png", width: result.width, height: result.height, bytes: result.blob.size });
              setError("");
            }
          } catch (caught) {
            if (latestRender.current === job) setError(caught instanceof Error ? caught.message : "Could not render this edit.");
          }
          if (latestRender.current === job) {
            latestRender.current = null;
            setPreviewUpdating(false);
          }
        }
      } finally {
        rendering.current = false;
      }
    }
    void renderLatest();
    return () => { if (latestRender.current === request) latestRender.current = null; };
  }, [file, edit, adjusting]);

  const latestOutputRender = useRef<{ file: File; edit: Edit; format: OutputFormat } | null>(null);
  const outputRendering = useRef(false);
  useEffect(() => {
    if (!file || !saveOpen) return;
    const request = { file, edit, format: saveFormat };
    latestOutputRender.current = request;
    setSaveUpdating(true);
    setError("");
    async function renderLatestOutput() {
      if (outputRendering.current) return;
      outputRendering.current = true;
      try {
        while (latestOutputRender.current) {
          const job = latestOutputRender.current;
          const filter = filters.find(({ name }) => name === job.edit.filter) ?? filters[0];
          const appearance = {
            ...job.edit,
            contrast: (1 + job.edit.contrast) * (1 + filter.contrast) - 1,
            saturation: (1 + job.edit.saturation) * (1 + filter.saturation) - 1,
            warmth: job.edit.warmth + filter.warmth,
          };
          try {
            const result = await renderOutputImage(job.file, job.edit.preset, job.format, job.edit.background, job.edit, appearance);
            if (latestOutputRender.current === job) {
              setOutputPreview({ blob: result.blob, edit: job.edit, file: job.file, format: job.format, width: result.width, height: result.height, bytes: result.blob.size });
              setError("");
            }
          } catch (caught) {
            if (latestOutputRender.current === job) setError(caught instanceof Error ? caught.message : "Could not prepare this export.");
          }
          if (latestOutputRender.current === job) {
            latestOutputRender.current = null;
            setSaveUpdating(false);
          }
        }
      } finally {
        outputRendering.current = false;
      }
    }
    void renderLatestOutput();
    return () => {
      if (latestOutputRender.current === request) {
        latestOutputRender.current = null;
        setSaveUpdating(false);
      }
    };
  }, [file, edit, saveFormat, saveOpen]);

  const slider = (label: string, key: Exclude<keyof PhotoAdjustments, "fillMode">, min: number, max: number, step: number) => (
    <label className={key === "straighten" ? "studio-slider studio-dial" : "studio-slider"}>
      <span>{label}<output>{key === "straighten" ? `${straighten}°` : key === "zoom" ? `${zoom.toFixed(2)}×` : `${Math.round(edit[key] * 100)}`}</output></span>
      <input id={`studio-${key}`} type="range" min={min} max={max} step={step} value={key === "straighten" ? straighten : key === "zoom" ? Math.round(zoom * 20) / 20 : edit[key]}
        aria-valuetext={key === "straighten" ? `${straighten} degrees` : undefined}
        style={(() => {
          const value = key === "straighten" ? straighten : key === "zoom" ? zoom : edit[key];
          const progress = Math.max(0, Math.min(1, (value - min) / (max - min)));
          const fillStart = min < 0 ? Math.min(progress, .5) : 0;
          const fillEnd = min < 0 ? Math.max(progress, .5) : progress;
          return {
            "--slider-fill-start": `${fillStart * 100}%`,
            "--slider-fill-end": `${fillEnd * 100}%`,
            "--slider-progress": `${progress * 100}%`,
          } as CSSProperties;
        })()}
        onPointerDown={(event) => {
          if (key === "zoom") zoomDrag.current = edit.zoom;
          gesture.current = { changed: false };
          if (key !== "zoom") setAdjusting(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (key === "zoom" && zoomDrag.current !== null) {
            change({ zoom: zoomDrag.current });
            zoomDrag.current = null;
            setZoomDraft(null);
          }
        }}
        onLostPointerCapture={() => { setAdjusting(false); gesture.current = null; zoomDrag.current = null; setZoomDraft(null); }}
        onBlur={() => { gesture.current = null; }}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (key === "zoom" && zoomDrag.current !== null) {
            zoomDrag.current = value;
            setZoomDraft(value);
            return;
          }
          if (value === edit[key]) return;
          change({ [key]: value }, gesture.current?.changed);
          if (gesture.current) gesture.current.changed = true;
        }} />
      <span className="studio-slider-scale" aria-hidden="true">
        <small>{key === "zoom" ? `${min}×` : key === "straighten" ? `${min}°` : min * 100}</small>
        <small>{min < 0 ? 0 : ""}</small>
        <small>{key === "zoom" ? `${max}×` : key === "straighten" ? `${max}°` : max * 100}</small>
      </span>
    </label>
  );
  const extension = outputExtension(saveFormat);
  const defaultFilename = `${filenameStem(file?.name ?? "photo") || "photo"}-edited`;
  function openSaveDialog() {
    if (!file) return;
    setSaveFilename(defaultFilename);
    setSaveStatus("");
    if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current);
    setSaveOpen(true);
  }
  function closeSaveDialog() {
    const dialog = saveDialogRef.current;
    if (dialog?.open) dialog.close();
    setSaveOpen(false);
  }
  function restoreSaveFocus() {
    requestAnimationFrame(() => saveTriggerRef.current?.focus());
  }
  function saveCopy() {
    if (!file || !saveReady || !outputPreview) return;
    const stem = safeFilenameStem(saveFilename, defaultFilename);
    const download = document.createElement("a");
    const outputUrl = URL.createObjectURL(outputPreview.blob);
    download.href = outputUrl;
    download.download = `${stem}.${extension}`;
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(outputUrl), 1000);
    setSavedEdit(edit);
    setSaveStatus(`Saved ${stem}.${extension}`);
    if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current);
    saveStatusTimer.current = window.setTimeout(() => setSaveStatus(""), 4000);
    closeSaveDialog();
  }
  const cropAt = (x: number, y: number) => {
    const drag = cropDrag.current;
    if (!drag) return null;
    const dx = (x - drag.x) / drag.width;
    const dy = (y - drag.y) / drag.height;
    return drag.corner
      ? { panX: edit.panX, panY: edit.panY, zoom: Math.max(1, Math.min(3, edit.zoom + (dx * (drag.corner.includes("e") ? 1 : -1) + dy * (drag.corner.includes("s") ? 1 : -1)) * 2)) }
      : { zoom: edit.zoom, panX: Math.max(-.45, Math.min(.45, edit.panX + dx)), panY: Math.max(-.45, Math.min(.45, edit.panY + dy)) };
  };

  return <main className="ticket-studio" aria-labelledby="studio-title">
    <header className="studio-header">
      <h1 id="studio-title" className="studio-brand"><Image src="/images/ticketstandard-wordmark.png" alt="TicketStandard" width={2172} height={724} priority /></h1>
      <div className="studio-header-left">
      <Link href="/" className="studio-pill studio-solid studio-back" onClick={(event) => {
        if (dirty && edit !== savedEdit && !window.confirm("Leave Photo Studio and discard unsaved edits?")) event.preventDefault();
      }}>Back</Link>
      <div className="studio-actions">
        <button type="button" aria-label="Undo" disabled={!history.index} onClick={() => setHistory((value) => ({ ...value, index: value.index - 1 }))}><ArrowCounterClockwise size={22} /></button>
        <button type="button" aria-label="Redo" disabled={history.index >= history.entries.length - 1} onClick={() => setHistory((value) => ({ ...value, index: value.index + 1 }))}><ArrowClockwise size={22} /></button>
      </div>
      </div>
      <div className="studio-header-right">
      <div className="studio-export-options">
        <button type="button" className="studio-pill studio-reset" disabled={!dirty} onClick={() => {
          if (window.confirm("Revert all edits to this photo?")) change(initial);
        }}>Revert</button>
        <label className="studio-select">Frame fill
          <select disabled={!file} value={edit.fillMode ?? "none"}
            onChange={event => change({ fillMode: event.target.value as Edit["fillMode"] })}>
            <option value="none">Transparent</option>
            <option value="color">Color</option>
            <option value="blur">Blurred photo</option>
          </select>
        </label>
        {edit.fillMode === "color" &&
          <label className="studio-color-control" aria-label="Frame color"><input className="studio-fill-color" aria-label="Frame color" title="Frame color" type="color" value={edit.background}
            onChange={event => change({ background: event.target.value })} /></label>}

      </div>
      <div className="studio-export-action">
        <button ref={saveTriggerRef} type="button" className="studio-pill studio-solid studio-save" disabled={!file} onClick={openSaveDialog}>
          <DownloadSimple size={18} /> Save copy
        </button>
        {saveStatus && <small role="status" aria-live="polite">{saveStatus}</small>}
      </div>
      </div>
    </header>
    <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { load(event.target.files?.[0]); event.target.value = ""; }} />
    <aside className="studio-details" aria-label="Photo details">
      <h2>Photo details</h2>
      <button type="button" className="studio-pill studio-details-toggle" aria-expanded={detailsOpen}
        aria-controls="studio-details-content" onClick={() => setDetailsOpen(value => !value)}>Photo details</button>
      <div id="studio-details-content" data-open={detailsOpen}>
      {file ? <><h3 className="studio-source-title">Source</h3><dl>
        <dt>File name</dt><dd>{file.name}</dd>
        {!!report?.width && <><dt>Source dimensions</dt><dd>{report.width} × {report.height} px</dd></>}
        <dt>Format</dt><dd>{file.type.split("/")[1].toUpperCase()}</dd>
        <dt>File size</dt><dd>{new Intl.NumberFormat("en", { style: "unit", unit: "megabyte", maximumFractionDigits: 2 }).format(file.size / 1_000_000)}</dd>
      </dl></> : <p>Open a photo to see its details.</p>}
      {saveReady && outputPreview && <section className="studio-output-details" aria-label="Output details">
        <h3 className="studio-source-title">Output</h3>
        <dl>
          <dt>Dimensions</dt><dd>{outputPreview.width} × {outputPreview.height} px</dd>
          <dt>File size</dt><dd>{formatFileSize(outputPreview.bytes)}</dd>
        </dl>
      </section>}
      </div>
      {error && <p className="studio-error" role="alert">{error}</p>}
    </aside>
    <div className="studio-preview-column">
      {source && <div className="studio-preview-actions">
        <button type="button" className="studio-pill studio-replace-photo" onClick={() => picker.current?.click()}>Open another photo</button>
        <button type="button" className="studio-pill" aria-pressed={inspect} onClick={() => setInspect(!inspect)}>{inspect ? "Fit" : "Inspect 2×"}</button>
        <button type="button" className="studio-pill" disabled={!dirty} aria-pressed={showOriginal} onClick={() => setCompare(value => !value)}>Compare</button>

      </div>}
    <div ref={stageRef} className="studio-stage" aria-busy={openingPhoto || cloudJob === "deblur"} data-file-drop={isDropping}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        if (!loadingSample) setIsDropping(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = loadingSample ? "none" : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setIsDropping(false);
      }}
      onDrop={event => {
        event.preventDefault();
        dragDepth.current = 0;
        setIsDropping(false);
        if (!loadingSample) load(event.dataTransfer.files[0]);
      }}>
      {isDropping && <div className="studio-drop-message" role="status">Drop your photo here</div>}
      {source && !showCrop ? <div className={`studio-preview-surface${showOriginal ? " is-original" : ""}${inspect ? " is-inspecting" : ""}`}>
        <img src={showOriginal ? source : preview?.url || source} alt={showOriginal ? "Original photo" : "Photo preview"}
          style={adjusting && !showOriginal ? { filter: `brightness(${2 ** (edit.exposure - (preview?.edit.exposure ?? 0))}) contrast(${(1 + edit.contrast) / (1 + (preview?.edit.contrast ?? 0))}) saturate(${(1 + edit.saturation) / Math.max(.01, 1 + (preview?.edit.saturation ?? 0))})` } : undefined}
          onLoad={() => setDisplayedSource(source)}
          onError={() => { setDisplayedSource(source); setError("The photo preview could not be displayed."); }} />
      </div> : !source &&
        <div className="studio-empty">
          <div className="studio-import"><ImageSquare size={38} aria-hidden="true" /><strong>Open a photo</strong><span>Drag and drop a JPEG, PNG, or WebP here</span></div>
          <button className="studio-pill studio-solid studio-browse" type="button" disabled={loadingSample} onClick={() => picker.current?.click()}>Browse files</button>
          <button className="studio-pill" type="button" disabled={loadingSample} onClick={() => void openSample()}>{loadingSample ? "Opening sample…" : "Try the model-kit sample"}</button>
        </div>}
      {showOriginal && <span className="studio-original-badge">Original</span>}
      {openingPhoto && <div className="studio-proof-loader" role="status">
        <span className="studio-proof-frame" aria-hidden="true" />
        <span>Opening photo…</span>
      </div>}
      {cloudJob === "deblur" && <div className="studio-refine-loader" role="status" aria-live="polite">
        <div className="studio-refine-loader-card">
          <span className="studio-refine-skeleton" aria-hidden="true"><i /><i /><i /></span>
          <span className="studio-refine-loader-label">Refining photo<span className="studio-refine-dots" aria-hidden="true"><i /><i /><i /></span></span>
        </div>
      </div>}
      {source && showCrop && <div className="studio-crop-overlay"
        style={{ width: cropWidth, height: cropWidth / frameRatio }}
        onPointerDown={(event) => {
          const { width, height } = event.currentTarget.getBoundingClientRect();
          cropDrag.current = { x: event.clientX, y: event.clientY, width, height, corner: (event.target as HTMLElement).dataset.corner ?? null };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!cropDrag.current) return;
          const next = cropAt(event.clientX, event.clientY);
          setDraft(next);
        }}
        onPointerUp={(event) => { const next = cropAt(event.clientX, event.clientY); if (next) change(next); }}
        onLostPointerCapture={() => { cropDrag.current = null; setDraft(null); }}>
        <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
          <filter id="studio-crop-tone" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={colorMatrix} />
          </filter>
        </svg>
        <div className="studio-crop-image" style={{ backgroundColor: edit.fillMode === "color" ? edit.background : undefined }}>
          {edit.fillMode === "blur" && <div className="studio-crop-blur" style={{ backgroundImage: `url("${source}")` }} />}
          <img src={source} alt="Live crop preview" draggable={false} onLoad={() => setDisplayedSource(source)}
            style={{
              width: `${sourceWidth * fit / frameWidth * 100}%`,
              height: `${sourceHeight * fit / frameHeight * 100}%`,
              left: `${(0.5 + (draft?.panX ?? edit.panX)) * 100}%`,
              top: `${(0.5 + (draft?.panY ?? edit.panY)) * 100}%`,
              transform: `translate(-50%, -50%) scaleX(${edit.flipHorizontal ? -1 : 1}) rotate(${edit.rotation + straighten}deg) scale(${draft?.zoom ?? zoom})`,
              filter: "url(#studio-crop-tone)",
            }} />
        </div>
        <i data-corner="nw" /><i data-corner="ne" /><i data-corner="sw" /><i data-corner="se" />
      </div>}
    </div>
    </div>
    <div className="studio-console">
      <div className="studio-control-scroll">
      <fieldset className="studio-panel" aria-label={tab} disabled={!file}>
        {tab === "Adjust" && <div className="studio-adjustments">
          {slider("Exposure", "exposure", -1, 1, .05)}
          {slider("Contrast", "contrast", -.75, .75, .05)}
          {slider("Saturation", "saturation", -1, 1, .05)}
          {slider("Warmth", "warmth", -1, 1, .05)}
          {slider("Sharpness", "sharpness", 0, 1, .05)}
        </div>}
        {tab === "Filters" && <div className="studio-options studio-filter-grid">{filters.map(({ name, ...values }) => (
          <button className="studio-pill studio-filter" type="button" key={name} aria-pressed={edit.filter === name} onClick={() => change({ filter: name })}>
            {source && <img src={source} alt="" style={{ filter: `contrast(${1 + values.contrast}) saturate(${1 + values.saturation}) sepia(${Math.abs(values.warmth) * .5}) hue-rotate(${values.warmth < 0 ? 155 : 0}deg)` }} />}{name}
          </button>
        ))}</div>}
        {tab === "Crop" && <>
          <div className="studio-options">
            <button className="studio-pill" onClick={() => change({ rotation: ((edit.rotation + 270) % 360) as ImageTransform["rotation"] })}><ArrowCounterClockwise size={18} /> Rotate left</button>
            <button className="studio-pill" onClick={() => change({ rotation: ((edit.rotation + 90) % 360) as ImageTransform["rotation"] })}><ArrowClockwise size={18} /> Rotate right</button>
            <button className="studio-pill" aria-pressed={edit.flipHorizontal} onClick={() => change({ flipHorizontal: !edit.flipHorizontal, panX: -edit.panX })}><FlipHorizontal size={18} /> Flip</button>
          </div>
          <div className="studio-frame-picker" role="group" aria-label="Canvas frame">
            <h3>Frame</h3>
            {(["original", "square", "portrait", "landscape"] as const).map(preset => {
              const dimensions = preset === "original"
                ? report?.width && report.height ? `${rotatedWidth} × ${rotatedHeight}` : "Source size"
                : imagePresets.find(option => option.value === preset)?.label.split(" · ")[1];
              return <button type="button" key={preset} aria-pressed={edit.preset === preset} onClick={() => change({ preset })}>
                <i aria-hidden="true" data-shape={preset} />
                <span>{preset}<small>{dimensions}</small></span>
              </button>;
            })}
          </div>
          <div className="studio-adjustments">{slider("Crop zoom", "zoom", 1, 3, .05)}{slider("Straighten", "straighten", -30, 30, 1)}</div>
        </>}
        {tab === "Tools" && <div className="studio-options">
          <button type="button" className="studio-pill" disabled={!cloud.deblur || !!cloudJob} onClick={() => void runCloud("deblur")}><Sparkle size={17} /> Refine</button>
          <p role="status">{cloudJob ? "Repairing blur..." : cloudResult ? "Your repaired copy is ready." : !cloud.deblur ? "The local model is offline." : ""}</p>
          {cloudResult && <button type="button" className="studio-pill" onClick={() => {
            if (!dirty || window.confirm("Open the generated copy and replace the current edits?")) load(cloudResult);
          }}>Open generated copy</button>}
        </div>}
      </fieldset>
      </div>
      <nav className="studio-dock" aria-label="Editing categories">
        {tabs.map(({ name, Icon }) => <button key={name} type="button" aria-pressed={tab === name} onClick={() => setTab(name)}><Icon size={22} weight={tab === name ? "bold" : "regular"} />{name}</button>)}
      </nav>

    </div>
    <dialog ref={saveDialogRef} className="studio-save-dialog" aria-labelledby="studio-save-title" aria-describedby="studio-save-description"
      aria-busy={!saveReady} onCancel={event => { event.preventDefault(); closeSaveDialog(); }} onClose={() => { setSaveOpen(false); restoreSaveFocus(); }}>
      <form className="studio-save-form" onSubmit={event => { event.preventDefault(); saveCopy(); }}>
        <div className="studio-save-heading">
          <div>
            <h2 id="studio-save-title">Save photo</h2>
            <p id="studio-save-description">Choose a name and format for your edited copy.</p>
          </div>
        </div>
        <label className="studio-save-field" htmlFor="studio-save-filename">
          <span>File name</span>
          <span className="studio-save-filename-row">
            <input ref={saveFilenameRef} id="studio-save-filename" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
              value={saveFilename} onChange={event => setSaveFilename(event.target.value)} />
            <span className="studio-save-extension" aria-label={`Extension ${extension}`}>.{extension}</span>
          </span>
        </label>
        <label className="studio-save-field studio-select" htmlFor="studio-save-format">
          <span>Format</span>
          <select id="studio-save-format" value={saveFormat} onChange={event => setSaveFormat(event.target.value as OutputFormat)}>
            <option value="image/png">PNG</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/webp">WebP</option>
          </select>
        </label>
        <section className="studio-save-details" aria-label="File details" data-updating={!saveReady} aria-live="polite">
          <h3>File details <span role="status">{saveUpdating ? "Updating" : ""}</span></h3>
          <dl>
            <dt>Dimensions</dt><dd key={outputPreview?.width && outputPreview?.height ? `${outputPreview.width}x${outputPreview.height}` : "dimensions-pending"} className="studio-save-detail-value">{outputPreview?.file === file && outputPreview.edit === edit ? `${outputPreview.width} × ${outputPreview.height} px` : report?.width ? `${report.width} × ${report.height} px` : "Preparing…"}</dd>
            <dt>File size</dt><dd key={outputPreview?.bytes ?? "size-pending"} className="studio-save-detail-value">{outputPreview?.file === file && outputPreview.edit === edit ? formatFileSize(outputPreview.bytes) : "Preparing…"}</dd>
          </dl>
        </section>
        {error && !saveReady && <p className="studio-save-error" role="alert">{error}</p>}
        <div className="studio-save-dialog-actions">
          <button type="button" className="studio-pill studio-save-cancel" onClick={closeSaveDialog}>Cancel</button>
          <button type="submit" className="studio-pill studio-solid studio-save" disabled={!file || !saveReady || !outputPreview}>
            <DownloadSimple size={17} /> Save copy
          </button>
        </div>
      </form>
    </dialog>
  </main>;
}

