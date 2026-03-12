"use client";

import { useMemo, useRef, useState } from "react";

type ToolMode = "bruise" | "erase" | null;
type PassIndex = 0 | 1 | 2;
type SavedMask = Uint8ClampedArray | null;
type BruiseAgeKey =
  | "unknown"
  | "within24h"
  | "day1to2"
  | "day3to4"
  | "day5to7"
  | "day8to10"
  | "day11to13"
  | "day14plus";

type StageKey = "red" | "blue" | "purple" | "brown" | "yellow" | "resolved";
type ConsistencyLabel = "Low" | "Moderate" | "High";
type IntensityLabel = "Mild" | "Moderate" | "Strong" | "Very Strong";

type AnalysisResult = {
  stageKey: StageKey;
  stageLabel: string;
  stageSummaryLines: string[];
  stageContextLine?: string;
  stageProgressPercent: number;
  consistencyLabel: ConsistencyLabel;
  consistencyTitle: string;
  consistencyMeaningLines: string[];
  intensityLabel: IntensityLabel;
  intensityLines: string[];
  consensusPixels: number;
  refinedCount: number;
  avgR: number;
  avgG: number;
  avgB: number;
  coreAvgR: number;
  coreAvgG: number;
  coreAvgB: number;
};

const FRAME_SIZE = 560;
const PASS_LABELS = ["Tight", "Balanced", "Broad"] as const;
const STAGE_FLOW = ["Red", "Blue", "Purple", "Brown", "Yellow", "Resolved"] as const;
const PAN_PADDING = 80;

const DEFAULT_ZOOM = 1;
const BRUISE_BRUSH_MIN = 10;
const BRUISE_BRUSH_MAX = 70;
const ERASE_BRUSH_MIN = 10;
const ERASE_BRUSH_MAX = 70;
const DEFAULT_BRUISE_BRUSH = (BRUISE_BRUSH_MIN + BRUISE_BRUSH_MAX) / 2;
const DEFAULT_ERASE_BRUSH = (ERASE_BRUSH_MIN + ERASE_BRUSH_MAX) / 2;

const AGE_OPTIONS: { key: BruiseAgeKey; label: string }[] = [
  { key: "unknown", label: "Unknown" },
  { key: "within24h", label: "Within 24 hours" },
  { key: "day1to2", label: "1–2 days" },
  { key: "day3to4", label: "3–4 days" },
  { key: "day5to7", label: "5–7 days" },
  { key: "day8to10", label: "8–10 days" },
  { key: "day11to13", label: "11–13 days" },
  { key: "day14plus", label: "14+ days" },
];

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    switch (max) {
      case rn:
        h = ((gn - bn) / d) % 6;
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;

  return { h, s, v };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState({ width: 0, height: 0 });
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const [toolMode, setToolMode] = useState<ToolMode>(null);
  const [bruiseBrushSize, setBruiseBrushSize] = useState(DEFAULT_BRUISE_BRUSH);
  const [eraseBrushSize, setEraseBrushSize] = useState(DEFAULT_ERASE_BRUSH);

  const [draggingImage, setDraggingImage] = useState(false);
  const [painting, setPainting] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);

  const [bruiseAge, setBruiseAge] = useState<BruiseAgeKey>("unknown");

  const [analysisText, setAnalysisText] = useState(
    "Upload a photo, then complete guided selections from Tight to Broad for a more stable interpretation."
  );

  const [currentPass, setCurrentPass] = useState<PassIndex>(0);
  const [savedSelections, setSavedSelections] = useState<[SavedMask, SavedMask, SavedMask]>([
    null,
    null,
    null,
  ]);
  const [refinedSelections, setRefinedSelections] = useState<[SavedMask, SavedMask, SavedMask]>([
    null,
    null,
    null,
  ]);
  const [sameAsPrevious, setSameAsPrevious] = useState<[boolean, boolean, boolean]>([
    false,
    false,
    false,
  ]);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetStartRef = useRef({ x: 0, y: 0 });
  const currentObjectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const roiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function getDisplayedSize(currentZoom: number, natural = imgNaturalSize) {
    if (!natural.width || !natural.height) {
      return { width: FRAME_SIZE * currentZoom, height: FRAME_SIZE * currentZoom };
    }

    const scaleToCover = Math.max(FRAME_SIZE / natural.width, FRAME_SIZE / natural.height);

    return {
      width: natural.width * scaleToCover * currentZoom,
      height: natural.height * scaleToCover * currentZoom,
    };
  }

  function clampOffset(
    nextX: number,
    nextY: number,
    currentZoom: number,
    natural = imgNaturalSize
  ) {
    const displayed = getDisplayedSize(currentZoom, natural);

    const minX = FRAME_SIZE - displayed.width - PAN_PADDING;
    const maxX = PAN_PADDING;
    const minY = FRAME_SIZE - displayed.height - PAN_PADDING;
    const maxY = PAN_PADDING;

    return {
      x: Math.max(minX, Math.min(maxX, nextX)),
      y: Math.max(minY, Math.min(maxY, nextY)),
    };
  }

  function centerImage(currentZoom: number, natural = imgNaturalSize) {
    const displayed = getDisplayedSize(currentZoom, natural);

    return clampOffset(
      (FRAME_SIZE - displayed.width) / 2,
      (FRAME_SIZE - displayed.height) / 2,
      currentZoom,
      natural
    );
  }

  function getZoomOffsetKeepingFrameCenter(
    prevZoom: number,
    nextZoom: number,
    currentOffset: { x: number; y: number },
    natural = imgNaturalSize
  ) {
    const prevSize = getDisplayedSize(prevZoom, natural);
    const nextSize = getDisplayedSize(nextZoom, natural);

    const frameCenterX = FRAME_SIZE / 2;
    const frameCenterY = FRAME_SIZE / 2;

    const imagePointX = (frameCenterX - currentOffset.x) / prevSize.width;
    const imagePointY = (frameCenterY - currentOffset.y) / prevSize.height;

    const rawX = frameCenterX - imagePointX * nextSize.width;
    const rawY = frameCenterY - imagePointY * nextSize.height;

    return clampOffset(rawX, rawY, nextZoom, natural);
  }

  function clearMaskCanvasOnly() {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
  }

  function clearOverlayCanvasOnly() {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
  }

  function hardResetOverlay() {
    clearMaskCanvasOnly();
    clearOverlayCanvasOnly();
  }

  function clearMask() {
    hardResetOverlay();
    redrawOverlay();
  }

  function currentBrushSize() {
    return toolMode === "erase" ? eraseBrushSize : bruiseBrushSize;
  }

  function drawBrush(x: number, y: number) {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;

    const radius = currentBrushSize() / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);

    if (toolMode === "bruise") {
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fill();
    } else if (toolMode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
    redrawOverlay();
  }

  function drawCurrentViewToCanvas() {
    const img = imgRef.current;
    const roiCanvas = roiCanvasRef.current;
    if (!img || !roiCanvas) return null;

    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const displayed = getDisplayedSize(zoom);

    roiCanvas.width = FRAME_SIZE;
    roiCanvas.height = FRAME_SIZE;
    ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
    ctx.drawImage(img, imgOffset.x, imgOffset.y, displayed.width, displayed.height);

    return ctx;
  }

  function getMaskFromCanvas() {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return null;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!maskCtx) return null;
    const maskData = maskCtx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data;
    const out = new Uint8ClampedArray(FRAME_SIZE * FRAME_SIZE);

    for (let i = 0; i < FRAME_SIZE * FRAME_SIZE; i++) {
      out[i] = maskData[i * 4 + 3] > 10 ? 1 : 0;
    }

    return out;
  }

  function loadMaskToCanvas(mask: Uint8ClampedArray | null) {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return;

    maskCtx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);

    if (mask) {
      const imageData = maskCtx.createImageData(FRAME_SIZE, FRAME_SIZE);
      for (let i = 0; i < FRAME_SIZE * FRAME_SIZE; i++) {
        if (mask[i]) {
          const p = i * 4;
          imageData.data[p] = 255;
          imageData.data[p + 1] = 255;
          imageData.data[p + 2] = 255;
          imageData.data[p + 3] = 255;
        }
      }
      maskCtx.putImageData(imageData, 0, 0);
    }

    redrawOverlay();
  }

  function getLuminance(r: number, g: number, b: number) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function countMaskPixels(mask: Uint8ClampedArray | null) {
    if (!mask) return 0;
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) count++;
    }
    return count;
  }

  function findConnectedComponents(
    candidateMask: Uint8ClampedArray,
    width: number,
    height: number
  ) {
    const visited = new Uint8Array(width * height);
    const components: number[][] = [];
    const dirs = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];

    for (let i = 0; i < candidateMask.length; i++) {
      if (!candidateMask[i] || visited[i]) continue;

      const queue = [i];
      const comp: number[] = [];
      visited[i] = 1;

      while (queue.length) {
        const current = queue.pop() as number;
        comp.push(current);

        const x = current % width;
        const y = Math.floor(current / width);

        for (const d of dirs) {
          const ni = current + d;
          if (ni < 0 || ni >= candidateMask.length) continue;

          const nx = ni % width;
          const ny = Math.floor(ni / width);
          if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;
          if (!candidateMask[ni] || visited[ni]) continue;

          visited[ni] = 1;
          queue.push(ni);
        }
      }

      components.push(comp);
    }

    return components.sort((a, b) => b.length - a.length);
  }

  function refineSelection(
    rawMask: Uint8ClampedArray,
    rgbaData: Uint8ClampedArray,
    width: number,
    height: number
  ) {
    const rawCount = countMaskPixels(rawMask);
    if (rawCount < 20) return rawMask;

    let lumSum = 0;
    let selectedCount = 0;
    const luminances = new Float32Array(width * height);

    for (let i = 0; i < rawMask.length; i++) {
      if (!rawMask[i]) continue;
      const p = i * 4;
      const lum = getLuminance(rgbaData[p], rgbaData[p + 1], rgbaData[p + 2]);
      luminances[i] = lum;
      lumSum += lum;
      selectedCount++;
    }

    if (!selectedCount) return rawMask;

    const meanLum = lumSum / selectedCount;
    const threshold = meanLum - 12;
    const candidateMask = new Uint8ClampedArray(width * height);

    for (let i = 0; i < rawMask.length; i++) {
      if (!rawMask[i]) continue;
      if (luminances[i] < threshold) candidateMask[i] = 1;
    }

    let components = findConnectedComponents(candidateMask, width, height);
    const minClusterSize = Math.max(18, Math.floor(rawCount * 0.015));
    components = components.filter((comp) => comp.length >= minClusterSize);

    if (components.length > 0) {
      const refined = new Uint8ClampedArray(width * height);
      for (const idx of components[0]) refined[idx] = 1;
      return refined;
    }

    const rawPixels: Array<{ idx: number; lum: number }> = [];
    for (let i = 0; i < rawMask.length; i++) {
      if (!rawMask[i]) continue;
      rawPixels.push({ idx: i, lum: luminances[i] });
    }

    rawPixels.sort((a, b) => a.lum - b.lum);
    const keepCount = Math.max(20, Math.floor(rawPixels.length * 0.22));
    const fallback = new Uint8ClampedArray(width * height);

    for (let i = 0; i < keepCount && i < rawPixels.length; i++) {
      fallback[rawPixels[i].idx] = 1;
    }

    return fallback;
  }

  function buildConsensusMask(refinedMasks: SavedMask[]) {
    const countMap = new Uint8ClampedArray(FRAME_SIZE * FRAME_SIZE);
    let available = 0;

    for (const mask of refinedMasks) {
      if (!mask) continue;
      available++;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i]) countMap[i] += 1;
      }
    }

    if (!available) {
      return { consensus: null as Uint8ClampedArray | null, countMap };
    }

    const consensus = new Uint8ClampedArray(FRAME_SIZE * FRAME_SIZE);
    let strongCount = 0;

    for (let i = 0; i < countMap.length; i++) {
      if (countMap[i] >= 2) {
        consensus[i] = 1;
        strongCount++;
      }
    }

    if (strongCount < 30) {
      for (let i = 0; i < countMap.length; i++) {
        consensus[i] = countMap[i] >= 1 ? 1 : 0;
      }
    }

    return { consensus, countMap };
  }

  function computeSelectionConsistency(refinedMasks: SavedMask[]) {
    const validMasks = refinedMasks.filter(Boolean) as Uint8ClampedArray[];
    if (validMasks.length === 0) return 0;

    let intersection = 0;
    let union = 0;

    for (let i = 0; i < FRAME_SIZE * FRAME_SIZE; i++) {
      let count = 0;
      for (const mask of validMasks) {
        if (mask[i]) count++;
      }
      if (count > 0) union++;
      if (count === validMasks.length) intersection++;
    }

    if (union === 0) return 0;
    return intersection / union;
  }

  function getConsistencyLabel(value: number): ConsistencyLabel {
    if (value >= 0.75) return "High";
    if (value >= 0.45) return "Moderate";
    return "Low";
  }

  function redrawOverlay() {
    const mask = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!mask || !overlay) return;

    const maskCtx = mask.getContext("2d", { willReadFrequently: true });
    const overlayCtx = overlay.getContext("2d");
    if (!maskCtx || !overlayCtx) return;

    const maskImg = maskCtx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data;
    overlayCtx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);

    for (let y = 0; y < FRAME_SIZE; y += 2) {
      for (let x = 0; x < FRAME_SIZE; x += 2) {
        const i = (y * FRAME_SIZE + x) * 4;

        if (maskImg[i + 3] >= 10) {
          overlayCtx.fillStyle = "rgba(87, 55, 204, 0.16)";
          overlayCtx.fillRect(x, y, 2, 2);

          if (x % 6 === 0 && y % 6 === 0) {
            overlayCtx.fillStyle = "rgba(113, 74, 221, 0.34)";
            overlayCtx.beginPath();
            overlayCtx.arc(x + 1, y + 1, 0.7, 0, Math.PI * 2);
            overlayCtx.fill();
          }
        }
      }
    }
  }

  function startMove(clientX: number, clientY: number) {
    if (!image) return;
    setDraggingImage(true);
    dragStartRef.current = { x: clientX, y: clientY };
    offsetStartRef.current = { ...imgOffset };
  }

  function moveImage(clientX: number, clientY: number) {
    if (!draggingImage) return;

    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;

    const rawX = offsetStartRef.current.x + dx;
    const rawY = offsetStartRef.current.y + dy;

    setImgOffset(clampOffset(rawX, rawY, zoom));
  }

  function endMove() {
    setDraggingImage(false);
  }

  function clearPass(passIdx: PassIndex) {
    const nextSaved = [...savedSelections] as [SavedMask, SavedMask, SavedMask];
    const nextRefined = [...refinedSelections] as [SavedMask, SavedMask, SavedMask];
    const nextSame = [...sameAsPrevious] as [boolean, boolean, boolean];

    nextSaved[passIdx] = null;
    nextRefined[passIdx] = null;
    nextSame[passIdx] = false;

    setSavedSelections(nextSaved);
    setRefinedSelections(nextRefined);
    setSameAsPrevious(nextSame);
    setResult(null);
    setCurrentPass(passIdx);
    clearMask();
    setAnalysisText(`Pass ${passIdx + 1} (${PASS_LABELS[passIdx]}) was cleared.`);
  }

  function savePass(passIdx: PassIndex) {
    if (!image) return;

    const roiCtx = drawCurrentViewToCanvas();
    if (!roiCtx) return;

    const roiData = roiCtx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data;

    let rawMask: Uint8ClampedArray | null = null;

    if (passIdx > 0 && sameAsPrevious[passIdx]) {
      const prev = savedSelections[passIdx - 1];
      if (!prev) {
        setAnalysisText("Previous selection is not available yet.");
        return;
      }
      rawMask = prev.slice();
    } else {
      rawMask = getMaskFromCanvas();
      if (!rawMask || countMaskPixels(rawMask) < 20) {
        setAnalysisText("Brush more of the bruise area before saving this pass.");
        return;
      }
    }

    const refined = refineSelection(rawMask, roiData, FRAME_SIZE, FRAME_SIZE);
    const nextSaved = [...savedSelections] as [SavedMask, SavedMask, SavedMask];
    const nextRefined = [...refinedSelections] as [SavedMask, SavedMask, SavedMask];

    nextSaved[passIdx] = rawMask;
    nextRefined[passIdx] = refined;

    setSavedSelections(nextSaved);
    setRefinedSelections(nextRefined);
    setResult(null);

    hardResetOverlay();

    if (passIdx < 2) {
      const nextPass = (passIdx + 1) as PassIndex;
      setCurrentPass(nextPass);
      redrawOverlay();
      setAnalysisText(
        `Pass ${passIdx + 1} saved. Continue with Pass ${nextPass + 1} (${PASS_LABELS[nextPass]}).`
      );
    } else {
      setCurrentPass(2);
      redrawOverlay();
      setAnalysisText("Pass 3 saved. All guided selections are ready.");
    }
  }

  function getAgeExpectedIndex(age: BruiseAgeKey) {
    switch (age) {
      case "within24h":
        return 0.2;
      case "day1to2":
        return 1.2;
      case "day3to4":
        return 2.0;
      case "day5to7":
        return 3.0;
      case "day8to10":
        return 4.0;
      case "day11to13":
        return 4.4;
      case "day14plus":
        return 5.0;
      default:
        return null;
    }
  }

  function analyzeConsensus() {
    const roiCtx = drawCurrentViewToCanvas();
    if (!roiCtx) return;

    const availableRefined = refinedSelections.filter(Boolean).length;
    if (availableRefined === 0) {
      setAnalysisText("Save at least one guided selection before analyzing.");
      return;
    }

    const roiData = roiCtx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data;
    const { consensus } = buildConsensusMask(refinedSelections);

    if (!consensus || countMaskPixels(consensus) < 20) {
      setAnalysisText(
        "Could not build a stable consensus area. Try brushing the bruise region more clearly."
      );
      return;
    }

    const consistencyValue = computeSelectionConsistency(refinedSelections);
    const consistencyLabel = getConsistencyLabel(consistencyValue);

    let consensusPixels = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    const selectedPixels: Array<{
      r: number;
      g: number;
      b: number;
      lum: number;
      idx: number;
    }> = [];

    for (let i = 0; i < consensus.length; i++) {
      if (!consensus[i]) continue;

      const p = i * 4;
      const r = roiData[p];
      const g = roiData[p + 1];
      const b = roiData[p + 2];
      const lum = getLuminance(r, g, b);

      consensusPixels++;
      sumR += r;
      sumG += g;
      sumB += b;
      selectedPixels.push({ r, g, b, lum, idx: i });
    }

    if (consensusPixels < 20) {
      setAnalysisText("Consensus region is too small to interpret reliably.");
      return;
    }

    const avgR = Math.round(sumR / consensusPixels);
    const avgG = Math.round(sumG / consensusPixels);
    const avgB = Math.round(sumB / consensusPixels);

    const sortedByLum = [...selectedPixels].sort((a, b) => a.lum - b.lum);
    const coreCount = Math.max(24, Math.floor(sortedByLum.length * 0.35));
    const corePixels = sortedByLum.slice(0, coreCount);

    let coreR = 0;
    let coreG = 0;
    let coreB = 0;
    let coreLumSum = 0;

    for (const px of corePixels) {
      coreR += px.r;
      coreG += px.g;
      coreB += px.b;
      coreLumSum += px.lum;
    }

    const coreAvgR = Math.round(coreR / corePixels.length);
    const coreAvgG = Math.round(coreG / corePixels.length);
    const coreAvgB = Math.round(coreB / corePixels.length);
    const coreMeanLum = coreLumSum / corePixels.length;

    const hsvAll = rgbToHsv(avgR, avgG, avgB);
    const hsvCore = rgbToHsv(coreAvgR, coreAvgG, coreAvgB);

    const redSignal = coreAvgR - (coreAvgG + coreAvgB) / 2;
    const blueSignal = coreAvgB - (coreAvgR + coreAvgG) / 2;
    const yellowSignal = (coreAvgR + coreAvgG) / 2 - coreAvgB;
    const warmSignal = coreAvgR - coreAvgB;

    const stageScores: Record<StageKey, number> = {
      red: 0,
      blue: 0,
      purple: 0,
      brown: 0,
      yellow: 0,
      resolved: 0,
    };

    if (hsvCore.h <= 18 || hsvCore.h >= 345) stageScores.red += 1.6;
    if (hsvCore.h >= 18 && hsvCore.h <= 40) {
      stageScores.red += 0.5;
      stageScores.brown += 0.8;
    }
    if (hsvCore.h >= 210 && hsvCore.h <= 255) stageScores.blue += 1.7;
    if (hsvCore.h >= 255 && hsvCore.h <= 320) stageScores.purple += 1.8;
    if (hsvCore.h >= 20 && hsvCore.h <= 55) stageScores.yellow += 1.2;
    if (hsvCore.h >= 18 && hsvCore.h <= 55 && coreMeanLum < 105) stageScores.brown += 1.4;

    if (redSignal > 18) stageScores.red += 0.9;
    if (blueSignal > 12) stageScores.blue += 1.0;
    if (blueSignal > 8 && redSignal > 8) stageScores.purple += 1.2;
    if (yellowSignal > 20) stageScores.yellow += 1.1;
    if (warmSignal > 18 && coreAvgG > coreAvgB + 6) stageScores.brown += 0.8;

    if (coreMeanLum < 78) {
      stageScores.blue += 0.4;
      stageScores.purple += 0.7;
      stageScores.brown += 0.4;
    }

    if (coreMeanLum > 112) {
      stageScores.yellow += 0.5;
      stageScores.resolved += 0.8;
    }

    if (hsvCore.s < 0.18 && coreMeanLum > 138) {
      stageScores.resolved += 2.4;
    }

    if (hsvAll.h >= 35 && hsvAll.h <= 70 && hsvAll.s > 0.18) {
      stageScores.yellow += 0.6;
    }

    const expectedIdx = getAgeExpectedIndex(bruiseAge);
    if (expectedIdx !== null) {
      if (expectedIdx <= 0.8) stageScores.red += 0.18;
      else if (expectedIdx <= 1.8) stageScores.blue += 0.18;
      else if (expectedIdx <= 2.8) stageScores.purple += 0.18;
      else if (expectedIdx <= 3.8) stageScores.brown += 0.18;
      else if (expectedIdx <= 4.8) stageScores.yellow += 0.18;
      else stageScores.resolved += 0.18;
    }

    const rankedStages = Object.entries(stageScores).sort((a, b) => b[1] - a[1]) as Array<
      [StageKey, number]
    >;

    const bestStage = rankedStages[0][0];

    let stageKey: StageKey = bestStage;
    let stageLabel = "Closest to Red";
    let stageSummaryLines = [
      "This bruise pattern may reflect an earlier visible stage.",
      "The color signal is currently interpreted closest to Red.",
      "Red tones often appear soon after injury, although appearance can vary across skin tones and lighting.",
    ];

    if (bestStage === "blue") {
      stageLabel = "Closest to Blue";
      stageSummaryLines = [
        "This bruise pattern may reflect an active bruising stage.",
        "The color signal is currently interpreted closest to Blue.",
        "Blue tones often appear after the earliest red phase, although appearance still varies by person and lighting.",
      ];
    } else if (bestStage === "purple") {
      stageLabel = "Closest to Purple";
      stageSummaryLines = [
        "This bruise pattern may still reflect an active bruising stage.",
        "The color signal is currently interpreted closest to Purple.",
        "Purple tones often suggest a darker bruise signal remains visible, but color alone cannot determine exact timing.",
      ];
    } else if (bestStage === "brown") {
      stageLabel = "Closest to Brown";
      stageSummaryLines = [
        "This bruise pattern may reflect a later healing stage.",
        "The color signal is currently interpreted closest to Brown.",
        "Brown tones often appear as bruising continues to change over time, though the sequence is not identical for everyone.",
      ];
    } else if (bestStage === "yellow") {
      stageLabel = "Closest to Yellow";
      stageSummaryLines = [
        "This bruise pattern may reflect a recovery stage.",
        "The color signal is currently interpreted closest to Yellow.",
        "Yellow tones are often associated with later healing, although healing speed can still vary from person to person.",
      ];
    } else if (bestStage === "resolved") {
      stageLabel = "Closest to Resolved";
      stageSummaryLines = [
        "The visible bruise signal appears faint or near-resolved.",
        "The color signal is currently interpreted closest to Resolved.",
        "Resolved means the visible bruise color has largely faded, not that recovery timing is identical for everyone.",
      ];
    }

    let stageContextLine: string | undefined;
    const stageOrder: Record<StageKey, number> = {
      red: 0,
      blue: 1,
      purple: 2,
      brown: 3,
      yellow: 4,
      resolved: 5,
    };

    if (expectedIdx !== null) {
      const diff = stageOrder[bestStage] - expectedIdx;

      if (diff <= -1.25) {
        stageContextLine =
          "Compared with the reported timing, the visible bruise signal looks earlier than expected.";
      } else if (diff >= 1.25) {
        stageContextLine =
          "Compared with the reported timing, the visible bruise signal looks later in healing than expected.";
      } else {
        stageContextLine =
          "Compared with the reported timing, the current color stage looks broadly in range.";
      }
    }

    let consistencyTitle = "Selections stayed consistent across passes";
    let consistencyMeaningLines = [
      "This reflects how similar your bruise boundary selections were across repeated passes.",
      "Higher consistency usually means the bruise boundary was easier to identify.",
    ];

    if (consistencyLabel === "Moderate") {
      consistencyTitle = "Selections changed slightly across passes";
      consistencyMeaningLines = [
        "This reflects how similar your bruise boundary selections were across repeated passes.",
        "A moderate result suggests the bruise boundary was visible, but not perfectly defined.",
      ];
    } else if (consistencyLabel === "Low") {
      consistencyTitle = "Selections changed noticeably across passes";
      consistencyMeaningLines = [
        "This reflects how similar your bruise boundary selections were across repeated passes.",
        "A low result usually means the bruise boundary was harder to define consistently.",
      ];
    }

    const darknessScore = clamp(Math.round(((148 - coreMeanLum) / 88) * 100), 0, 100);

    let intensityLabel: IntensityLabel = "Mild";
    let intensityLines = [
      "The bruise core appears relatively light compared with surrounding skin.",
      "The overall intensity is interpreted as Mild.",
    ];

    if (darknessScore >= 78) {
      intensityLabel = "Very Strong";
      intensityLines = [
        "The bruise core appears very dark compared with surrounding skin.",
        "The overall intensity is interpreted as Very Strong.",
      ];
    } else if (darknessScore >= 58) {
      intensityLabel = "Strong";
      intensityLines = [
        "The bruise core appears noticeably dark compared with surrounding skin.",
        "The overall intensity is interpreted as Strong.",
      ];
    } else if (darknessScore >= 38) {
      intensityLabel = "Moderate";
      intensityLines = [
        "The bruise core appears moderately darker than surrounding skin.",
        "The overall intensity is interpreted as Moderate.",
      ];
    }

    const stageOrderIndex = stageOrder[bestStage];
    const nextStageIndex = clamp(stageOrderIndex + 1, 0, 5);

    const bestScore = rankedStages[0][1];
    const secondScore = rankedStages[1][1];

    let withinStage = 0.5;
    if (nextStageIndex !== stageOrderIndex) {
      const gap = Math.max(0.001, bestScore - secondScore);
      withinStage = clamp(0.32 + (1 / (1 + gap)) * 0.45, 0.32, 0.78);
    } else {
      withinStage = 0.85;
    }

    const stageProgressPercent = clamp(((stageOrderIndex + withinStage) / 6) * 100, 6, 100);

    setResult({
      stageKey,
      stageLabel,
      stageSummaryLines,
      stageContextLine,
      stageProgressPercent,
      consistencyLabel,
      consistencyTitle,
      consistencyMeaningLines,
      intensityLabel,
      intensityLines,
      consensusPixels,
      refinedCount: availableRefined,
      avgR,
      avgG,
      avgB,
      coreAvgR,
      coreAvgG,
      coreAvgB,
    });

    setAnalysisText(
      "Consensus analysis complete. The final interpretation used the refined overlap region rather than a single brushed boundary."
    );

    hardResetOverlay();
  }

  function handleUpload(file: File) {
    const newUrl = URL.createObjectURL(file);
    const tempImg = new Image();

    tempImg.onload = () => {
      const natural = {
        width: tempImg.naturalWidth,
        height: tempImg.naturalHeight,
      };

      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
      }
      currentObjectUrlRef.current = newUrl;

      setImage(newUrl);
      setImgNaturalSize(natural);

      const initialZoom = DEFAULT_ZOOM;
      setZoom(initialZoom);
      setImgOffset(centerImage(initialZoom, natural));
      setToolMode(null);
      setHoverPoint(null);
      setBruiseBrushSize(DEFAULT_BRUISE_BRUSH);
      setEraseBrushSize(DEFAULT_ERASE_BRUSH);
      setSavedSelections([null, null, null]);
      setRefinedSelections([null, null, null]);
      setSameAsPrevious([false, false, false]);
      setCurrentPass(0);
      setResult(null);
      setBruiseAge("unknown");
      setAnalysisText(
        "Photo loaded. Start with Pass 1 (Tight), then continue to Balanced and Broad."
      );

      hardResetOverlay();
      redrawOverlay();

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    tempImg.onerror = () => {
      URL.revokeObjectURL(newUrl);
      setAnalysisText("Could not load that image. Try a different file.");
    };

    tempImg.src = newUrl;
  }

  function stageIndex(key: StageKey) {
    return {
      red: 0,
      blue: 1,
      purple: 2,
      brown: 3,
      yellow: 4,
      resolved: 5,
    }[key];
  }

  function intensityIndex(label: IntensityLabel) {
    return {
      Mild: 0,
      Moderate: 1,
      Strong: 2,
      "Very Strong": 3,
    }[label];
  }

  function consistencyIndex(label: ConsistencyLabel) {
    return {
      Low: 0,
      Moderate: 1,
      High: 2,
    }[label];
  }

  const displayed = getDisplayedSize(zoom);
  const bruiseActive = toolMode === "bruise";
  const eraseActive = toolMode === "erase";
  const canAnalyze = image && refinedSelections.some(Boolean);

  const showBrushCursor =
    image && hoverPoint && (toolMode === "bruise" || toolMode === "erase");
  const previewRadius = currentBrushSize();

  const savedCounts = useMemo(
    () => savedSelections.map((m) => (m ? countMaskPixels(m) : 0)),
    [savedSelections]
  );

  const activeStageIndex = result ? stageIndex(result.stageKey) : -1;

  return (
    <>
      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: #f4f7fc;
        }

        * {
          box-sizing: border-box;
        }

        input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: #d9e1ee;
          outline: none;
        }

        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #5b6f8f;
          border: 3px solid #f4f7fc;
          box-shadow: 0 2px 8px rgba(35, 53, 85, 0.18);
          cursor: pointer;
        }

        input[type="range"]::-moz-range-thumb {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #5b6f8f;
          border: 3px solid #f4f7fc;
          box-shadow: 0 2px 8px rgba(35, 53, 85, 0.18);
          cursor: pointer;
        }

        .ui-btn,
        .pass-action-btn,
        .analysis-pill {
          transition:
            background 0.18s ease,
            color 0.18s ease,
            border-color 0.18s ease,
            box-shadow 0.18s ease,
            opacity 0.18s ease,
            transform 0.18s ease,
            filter 0.18s ease;
        }

        .ui-btn:hover,
        .pass-action-btn:hover,
        .analysis-pill:hover {
          opacity: 0.98;
          transform: translateY(-1px);
        }

        .ui-btn.soft-blue-hover:hover {
          background: rgba(47, 98, 255, 0.08) !important;
          color: #2f62ff !important;
          border-color: #2f62ff !important;
          box-shadow:
            0 0 0 3px rgba(47, 98, 255, 0.14),
            0 0 0 7px rgba(47, 98, 255, 0.08),
            0 6px 14px rgba(47, 98, 255, 0.08) !important;
        }

        .ui-btn.soft-blue-hover.is-active:hover {
          background: #2f62ff !important;
          color: #ffffff !important;
          border-color: #2f62ff !important;
          box-shadow:
            0 0 0 3px rgba(47, 98, 255, 0.14),
            0 0 0 7px rgba(47, 98, 255, 0.08),
            0 6px 14px rgba(47, 98, 255, 0.08) !important;
        }

        .ui-btn.analyze-hover:hover:not(:disabled) {
          background: #ef0800 !important;
          color: #ffffff !important;
          border-color: #ef0800 !important;
          box-shadow:
            0 0 0 3px rgba(239, 8, 0, 0.12),
            0 0 0 7px rgba(239, 8, 0, 0.06),
            0 8px 18px rgba(239, 8, 0, 0.14) !important;
        }

        .pass-action-btn:hover,
        .analysis-pill:hover {
          box-shadow:
            0 0 0 2px rgba(47, 98, 255, 0.12),
            0 4px 10px rgba(47, 98, 255, 0.06);
        }

        .ui-btn:focus,
        .ui-btn:focus-visible,
        .pass-action-btn:focus,
        .pass-action-btn:focus-visible,
        .analysis-pill:focus,
        .analysis-pill:focus-visible,
        button:focus,
        button:focus-visible {
          outline: none !important;
        }

        .ui-btn:disabled:hover,
        .pass-action-btn:disabled:hover,
        .analysis-pill:disabled:hover {
          opacity: 1;
          transform: none;
          box-shadow: none;
        }
      `}</style>

      <main
        style={{
          padding: 22,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          maxWidth: 1540,
          margin: "0 auto",
          color: "#253858",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.42fr 1fr",
            gap: 28,
            alignItems: "start",
          }}
        >
          <section>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 18,
                marginBottom: 16,
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: 54,
                  lineHeight: 1,
                  fontWeight: 800,
                  letterSpacing: -1.6,
                  color: "#22365a",
                }}
              >
                BruiseTrace
              </h1>
              <span
                style={{
                  color: "#2f7cff",
                  fontSize: 24,
                  fontWeight: 500,
                  lineHeight: 1.1,
                }}
              >
                Inclusive skin signal measurement system
              </span>
            </div>

            <div style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d7e0ed",
                  borderRadius: 18,
                  padding: "24px 26px",
                  boxShadow: "0 2px 10px rgba(28,49,86,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 850,
                    color: "#233555",
                    marginBottom: 8,
                  }}
                >
                  Estimated bruise age
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#4a5e82",
                    marginBottom: 8,
                  }}
                >
                  When did the bruise likely begin?
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#6a82a8",
                    marginBottom: 20,
                  }}
                >
                  Helps interpret bruise color stages.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 12,
                  }}
                >
                  {AGE_OPTIONS.map((item) => {
                    const active = bruiseAge === item.key;
                    return (
                      <button
                        key={item.key}
                        className={`ui-btn soft-blue-hover ${active ? "is-active" : ""}`}
                        onClick={() => setBruiseAge(item.key)}
                        style={{
                          height: 60,
                          borderRadius: 12,
                          background: active ? "#2f62ff" : "#ffffff",
                          color: active ? "#ffffff" : "#4a5e82",
                          border: active ? "2px solid #2f62ff" : "1.5px solid #bfd0e6",
                          fontWeight: 800,
                          fontSize: 16,
                          cursor: "pointer",
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d7e0ed",
                  borderRadius: 18,
                  padding: "24px 26px",
                  boxShadow: "0 2px 10px rgba(28,49,86,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 850,
                    color: "#233555",
                    marginBottom: 8,
                  }}
                >
                  Guided selection flow
                </div>
                <div
                  style={{
                    fontSize: 15,
                    color: "#4a5e82",
                    lineHeight: 1.5,
                    marginBottom: 2,
                  }}
                >
                  To reduce boundary-selection error, make up to 3 guided selections:
                </div>
                <div
                  style={{
                    fontSize: 15,
                    color: "#4a5e82",
                    lineHeight: 1.5,
                    marginBottom: 22,
                  }}
                >
                  <strong>Tight, Balanced</strong>, and <strong>Broad</strong>.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 14,
                    alignItems: "start",
                  }}
                >
                  <div>
                    <button
                      className="ui-btn soft-blue-hover is-active"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: "100%",
                        height: 60,
                        borderRadius: 14,
                        background: "#2f62ff",
                        color: "#ffffff",
                        border: "2px solid #2f62ff",
                        boxShadow: "0 2px 10px rgba(47,98,255,0.16)",
                        fontWeight: 800,
                        fontSize: 16,
                        cursor: "pointer",
                      }}
                    >
                      Upload Photo
                    </button>
                    <div style={{ marginTop: 16, padding: "0 10px" }}>
                      <input
                        type="range"
                        min="1"
                        max="2.5"
                        step="0.01"
                        value={zoom}
                        onChange={(e) => {
                          const nextZoom = Number(e.target.value);
                          setImgOffset((prev) =>
                            getZoomOffsetKeepingFrameCenter(zoom, nextZoom, prev)
                          );
                          setZoom(nextZoom);
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <button
                      className={`ui-btn soft-blue-hover ${bruiseActive ? "is-active" : ""}`}
                      onClick={() => setToolMode((prev) => (prev === "bruise" ? null : "bruise"))}
                      style={{
                        width: "100%",
                        height: 60,
                        borderRadius: 14,
                        background: bruiseActive ? "#2f62ff" : "#ffffff",
                        color: bruiseActive ? "#ffffff" : "#2f62ff",
                        border: "2px solid #2f62ff",
                        boxShadow: bruiseActive
                          ? "0 2px 10px rgba(47,98,255,0.16)"
                          : "none",
                        fontWeight: 800,
                        fontSize: 16,
                        cursor: "pointer",
                      }}
                    >
                      Bruise Brush
                    </button>
                    <div style={{ marginTop: 16, padding: "0 10px" }}>
                      <input
                        type="range"
                        min={BRUISE_BRUSH_MIN}
                        max={BRUISE_BRUSH_MAX}
                        step="1"
                        value={bruiseBrushSize}
                        onChange={(e) => setBruiseBrushSize(Number(e.target.value))}
                        disabled={!bruiseActive}
                        style={{ opacity: bruiseActive ? 1 : 0.35 }}
                      />
                    </div>
                  </div>

                  <div>
                    <button
                      className={`ui-btn soft-blue-hover ${eraseActive ? "is-active" : ""}`}
                      onClick={() => setToolMode((prev) => (prev === "erase" ? null : "erase"))}
                      style={{
                        width: "100%",
                        height: 60,
                        borderRadius: 14,
                        background: eraseActive ? "#2f62ff" : "#ffffff",
                        color: eraseActive ? "#ffffff" : "#2f62ff",
                        border: "2px solid #2f62ff",
                        boxShadow: eraseActive ? "0 2px 10px rgba(47,98,255,0.16)" : "none",
                        fontWeight: 800,
                        fontSize: 16,
                        cursor: "pointer",
                      }}
                    >
                      Erase
                    </button>
                    <div style={{ marginTop: 16, padding: "0 10px" }}>
                      <input
                        type="range"
                        min={ERASE_BRUSH_MIN}
                        max={ERASE_BRUSH_MAX}
                        step="1"
                        value={eraseBrushSize}
                        onChange={(e) => setEraseBrushSize(Number(e.target.value))}
                        disabled={!eraseActive}
                        style={{ opacity: eraseActive ? 1 : 0.35 }}
                      />
                    </div>
                  </div>

                  <div>
                    <button
                      className="ui-btn analyze-hover"
                      onClick={analyzeConsensus}
                      disabled={!canAnalyze}
                      style={{
                        width: "100%",
                        height: 78,
                        borderRadius: 16,
                        background: canAnalyze ? "#ef0800" : "#ffffff",
                        color: canAnalyze ? "#ffffff" : "#ef0800",
                        border: "2px solid #ef0800",
                        boxShadow: canAnalyze
                          ? "0 3px 14px rgba(239,8,0,0.18)"
                          : "0 0 0 1px rgba(239,8,0,0.02)",
                        fontWeight: 850,
                        fontSize: 18,
                        cursor: canAnalyze ? "pointer" : "default",
                      }}
                    >
                      Analyze
                    </button>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    handleUpload(file);
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 246px",
                  gap: 18,
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    border: "1px solid #c8d5e6",
                    borderRadius: 8,
                    overflow: "hidden",
                    position: "relative",
                    background: "#dfe6f1",
                    userSelect: "none",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)",
                    cursor: toolMode === null ? (draggingImage ? "grabbing" : "grab") : "default",
                  }}
                  onMouseDown={(e) => {
                    if (!image) return;

                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = ((e.clientX - rect.left) / rect.width) * FRAME_SIZE;
                    const y = ((e.clientY - rect.top) / rect.height) * FRAME_SIZE;

                    if (toolMode === null) {
                      startMove(e.clientX, e.clientY);
                    } else {
                      if (currentPass > 0 && sameAsPrevious[currentPass]) return;
                      setPainting(true);
                      drawBrush(x, y);
                    }
                  }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = ((e.clientX - rect.left) / rect.width) * FRAME_SIZE;
                    const y = ((e.clientY - rect.top) / rect.height) * FRAME_SIZE;

                    setHoverPoint({
                      x: (x / FRAME_SIZE) * rect.width,
                      y: (y / FRAME_SIZE) * rect.height,
                    });

                    if (!image) return;

                    if (draggingImage && toolMode === null) {
                      moveImage(e.clientX, e.clientY);
                      return;
                    }

                    if (toolMode !== null && painting) {
                      if (currentPass > 0 && sameAsPrevious[currentPass]) return;
                      drawBrush(x, y);
                    }
                  }}
                  onMouseUp={() => {
                    setPainting(false);
                    endMove();
                  }}
                  onMouseLeave={() => {
                    setPainting(false);
                    endMove();
                    setHoverPoint(null);
                  }}
                >
                  {image ? (
                    <>
                      <img
                        ref={imgRef}
                        src={image}
                        alt="bruise upload"
                        draggable={false}
                        style={{
                          position: "absolute",
                          left: `${(imgOffset.x / FRAME_SIZE) * 100}%`,
                          top: `${(imgOffset.y / FRAME_SIZE) * 100}%`,
                          width: `${(displayed.width / FRAME_SIZE) * 100}%`,
                          height: `${(displayed.height / FRAME_SIZE) * 100}%`,
                          maxWidth: "none",
                          pointerEvents: "none",
                        }}
                      />

                      <canvas
                        ref={overlayCanvasRef}
                        width={FRAME_SIZE}
                        height={FRAME_SIZE}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          pointerEvents: "none",
                        }}
                      />

                      <canvas
                        ref={maskCanvasRef}
                        width={FRAME_SIZE}
                        height={FRAME_SIZE}
                        style={{ display: "none" }}
                      />

                      {showBrushCursor &&
                        !(currentPass > 0 && sameAsPrevious[currentPass]) && (
                          <div
                            style={{
                              position: "absolute",
                              left: hoverPoint.x,
                              top: hoverPoint.y,
                              width: `${(previewRadius / FRAME_SIZE) * 100}%`,
                              height: `${(previewRadius / FRAME_SIZE) * 100}%`,
                              transform: "translate(-50%, -50%)",
                              borderRadius: "50%",
                              border:
                                toolMode === "bruise"
                                  ? "2px solid #59ff6a"
                                  : "2px solid #475569",
                              background:
                                toolMode === "bruise"
                                  ? "rgba(89,255,106,0.08)"
                                  : "rgba(0,0,0,0.05)",
                              pointerEvents: "none",
                            }}
                          />
                        )}
                    </>
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#425777",
                        fontSize: 28,
                        fontWeight: 500,
                      }}
                    >
                      Photo
                    </div>
                  )}

                  {image && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 16,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "rgba(56,42,34,0.72)",
                        color: "#ffffff",
                        padding: "8px 14px",
                        borderRadius: 10,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Pass {currentPass + 1} · {PASS_LABELS[currentPass]} ·{" "}
                      {toolMode === null
                        ? "Pan Image"
                        : toolMode === "bruise"
                        ? "Bruise Brush"
                        : "Erase"}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  {PASS_LABELS.map((label, idx) => {
                    const isSaved = !!savedSelections[idx];
                    const isCurrent = currentPass === idx;

                    return (
                      <div
                        key={label}
                        onClick={() => {
                          setCurrentPass(idx as PassIndex);
                          setResult(null);
                          if (savedSelections[idx]) loadMaskToCanvas(savedSelections[idx]);
                          else clearMask();
                          setAnalysisText(
                            `Pass ${idx + 1} (${label}) selected. Brush, erase, or reuse the previous pass if needed.`
                          );
                        }}
                        style={{
                          background: isSaved ? "#eefbf2" : isCurrent ? "#eef4ff" : "#ffffff",
                          border: isSaved
                            ? "1.5px solid #cfe7d4"
                            : isCurrent
                            ? "2px solid #2f62ff"
                            : "1px solid #d9e2ef",
                          borderRadius: 14,
                          padding: 18,
                          minHeight: 142,
                          boxShadow: "0 2px 10px rgba(28,49,86,0.05)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "baseline",
                              marginBottom: 12,
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 900,
                                fontSize: 18,
                                color: "#233555",
                              }}
                            >
                              Pass {idx + 1}
                            </div>
                            <div
                              style={{
                                fontWeight: 500,
                                fontSize: 14,
                                color: "#6b7d99",
                              }}
                            >
                              {label}
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize: 12,
                              color: "#90a0bb",
                              marginBottom: 10,
                            }}
                          >
                            {isSaved ? `Pass ${idx + 1}: ${savedCounts[idx]} px` : "Not saved"}
                          </div>

                          {idx > 0 && (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: 12,
                                color: "#6b7d99",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={sameAsPrevious[idx]}
                                onChange={(e) => {
                                  const next = [...sameAsPrevious] as [boolean, boolean, boolean];
                                  next[idx] = e.target.checked;
                                  setSameAsPrevious(next);
                                  if (currentPass !== idx) setCurrentPass(idx as PassIndex);
                                  if (e.target.checked) {
                                    const prev = savedSelections[idx - 1];
                                    if (prev) loadMaskToCanvas(prev);
                                  } else {
                                    clearMask();
                                  }
                                }}
                              />
                              Same as previous
                            </label>
                          )}
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <button
                            className="pass-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!image) return;

                              if (currentPass !== idx) {
                                setCurrentPass(idx as PassIndex);
                                if (savedSelections[idx]) loadMaskToCanvas(savedSelections[idx]);
                                else clearMask();
                                return;
                              }

                              if (isSaved) clearPass(idx as PassIndex);
                              else savePass(idx as PassIndex);
                            }}
                            style={{
                              height: 40,
                              minWidth: 90,
                              borderRadius: 8,
                              border: "1px solid #bfd0e6",
                              background: isSaved ? "#eef2f7" : "#2f62ff",
                              color: isSaved ? "#435879" : "#ffffff",
                              fontWeight: 700,
                              fontSize: 14,
                              cursor: "pointer",
                            }}
                          >
                            {isSaved ? "Cancel" : "Save"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                style={{
                  background: "#f8fbff",
                  border: "1px solid #d9e2ef",
                  borderRadius: 14,
                  padding: "24px 26px",
                  opacity: 0.62,
                  boxShadow: "0 2px 10px rgba(28,49,86,0.04)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "end",
                  gap: 20,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: "#7486a6",
                      marginBottom: 14,
                    }}
                  >
                    Recovery tracking (coming soon)
                  </div>
                  <div style={{ color: "#7e8faa", fontSize: 14, lineHeight: 1.55 }}>
                    Suggested re-check timing: compare another photo
                    <br />
                    after 24 hours to observe a clearer recovery trend.
                  </div>
                </div>

                <button
                  disabled
                  className="ui-btn"
                  style={{
                    height: 50,
                    minWidth: 102,
                    borderRadius: 10,
                    border: "1.5px solid #9db7ff",
                    background: "#ffffff",
                    color: "#5a87ff",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  Start
                </button>
              </div>
            </div>

            <canvas
              ref={roiCanvasRef}
              width={FRAME_SIZE}
              height={FRAME_SIZE}
              style={{ display: "none" }}
            />
          </section>

          <aside>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "start",
                marginBottom: 16,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 54,
                  lineHeight: 1,
                  fontWeight: 800,
                  letterSpacing: -1.6,
                  color: "#22365a",
                }}
              >
                Analysis
              </h2>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "#ffffff",
                  border: "1px solid #d9e2ef",
                  borderRadius: 999,
                  padding: "8px 14px",
                  boxShadow: "0 2px 10px rgba(28,49,86,0.06)",
                }}
              >
                <div style={{ textAlign: "right", lineHeight: 1.15 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#2a3e61" }}>sulma</div>
                  <div style={{ fontSize: 12, color: "#8ca0bf" }}>guest</div>
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    border: "1px solid #d9e2ef",
                    background: "#f7f9fd",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    color: "#6d7fa0",
                  }}
                >
                  ◔
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d9e2ef",
                  borderRadius: 18,
                  padding: 28,
                  boxShadow: "0 2px 10px rgba(28,49,86,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 850,
                    color: "#233555",
                    marginBottom: 18,
                  }}
                >
                  Color stages of a Bruise
                </div>

                {!result ? (
                  <div style={{ color: "#546884", fontSize: 14, lineHeight: 1.75 }}>
                    This card places the current bruise appearance within a commonly described
                    color-change pattern.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        color: "#546884",
                        fontSize: 14,
                        lineHeight: 1.75,
                        marginBottom: 18,
                      }}
                    >
                      {result.stageSummaryLines.map((line) => (
                        <div key={line} style={{ marginBottom: 4 }}>
                          {line}
                        </div>
                      ))}
                      {result.stageContextLine && (
                        <div
                          style={{
                            marginTop: 8,
                            fontWeight: 700,
                            color: "#425777",
                          }}
                        >
                          {result.stageContextLine}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(6, 1fr)",
                        gap: 10,
                        marginBottom: 14,
                      }}
                    >
                      {STAGE_FLOW.map((label, idx) => {
                        const active = idx === activeStageIndex;
                        return (
                          <div key={label} style={{ display: "flex", justifyContent: "center" }}>
                            <div
                              className="analysis-pill"
                              style={{
                                minWidth: 74,
                                padding: "8px 12px",
                                borderRadius: 999,
                                textAlign: "center",
                                border: active ? "3px solid #ef4423" : "1px solid #d0dae8",
                                background: "#ffffff",
                                fontWeight: active ? 800 : 500,
                                fontSize: 14,
                                color: "#374b69",
                              }}
                            >
                              {label}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(6, 1fr)",
                        gap: 0,
                        borderRadius: 8,
                        overflow: "hidden",
                        marginBottom: 14,
                      }}
                    >
                      {[
                        { key: "red", color: "#c93631" },
                        { key: "blue", color: "#3d65d7" },
                        { key: "purple", color: "#7a45d1" },
                        { key: "brown", color: "#aa602b" },
                        { key: "yellow", color: "#d39b2a" },
                        { key: "resolved", color: "transparent" },
                      ].map((item) => (
                        <div
                          key={item.key}
                          style={{
                            height: 40,
                            background:
                              item.key === "resolved"
                                ? "repeating-linear-gradient(45deg, rgba(0,0,0,0.04), rgba(0,0,0,0.04) 6px, rgba(0,0,0,0.01) 6px, rgba(0,0,0,0.01) 12px)"
                                : item.color,
                            border: item.key === "resolved" ? "2px dashed #cfdae8" : "none",
                            boxSizing: "border-box",
                          }}
                        />
                      ))}
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          width: `${result.stageProgressPercent}%`,
                          minWidth: 42,
                          height: 14,
                          background: "#334766",
                          clipPath:
                            "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)",
                          borderRadius: 2,
                        }}
                      />
                    </div>

                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: "#2f425f",
                      }}
                    >
                      Estimated stage
                    </div>
                  </>
                )}
              </div>

              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d9e2ef",
                  borderRadius: 18,
                  padding: 28,
                  boxShadow: "0 2px 10px rgba(28,49,86,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 850,
                    color: "#233555",
                    marginBottom: 18,
                  }}
                >
                  Bruise intensity
                </div>

                {!result ? (
                  <div style={{ color: "#546884", fontSize: 14, lineHeight: 1.75 }}>
                    This card estimates how visually strong the bruise core appears.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        color: "#546884",
                        fontSize: 14,
                        lineHeight: 1.75,
                        marginBottom: 22,
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>{result.intensityLines[0]}</div>
                      <div>{result.intensityLines[1]}</div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gap: 18,
                        alignItems: "start",
                      }}
                    >
                      {[
                        { label: "Mild", color: "#b7b7b7" },
                        { label: "Moderate", color: "#999999" },
                        { label: "Strong", color: "#676767" },
                        { label: "Very Strong", color: "#151821" },
                      ].map((item, idx) => {
                        const active = intensityIndex(result.intensityLabel) === idx;
                        return (
                          <div
                            key={item.label}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "flex-start",
                              minHeight: 170,
                            }}
                          >
                            <div
                              style={{
                                width: 104,
                                height: 104,
                                borderRadius: "50%",
                                background: "#e6e6e6",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <div
                                style={{
                                  width: 78,
                                  height: 78,
                                  borderRadius: "50%",
                                  background: item.color,
                                  boxShadow: "0 0 0 10px rgba(0,0,0,0.04)",
                                }}
                              />
                            </div>

                            <div
                              className="analysis-pill"
                              style={{
                                marginTop: 18,
                                minWidth: item.label === "Very Strong" ? 126 : 104,
                                textAlign: "center",
                                padding: "9px 18px",
                                borderRadius: 999,
                                border: active ? "3px solid #ef4423" : "1px solid #d0dae8",
                                background: "#ffffff",
                                fontWeight: active ? 800 : 500,
                                fontSize: 14,
                                color: "#374b69",
                                boxShadow: active ? "0 2px 8px rgba(239,68,35,0.08)" : "none",
                                lineHeight: item.label === "Very Strong" ? 1.25 : 1.2,
                              }}
                            >
                              {item.label}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d9e2ef",
                  borderRadius: 18,
                  padding: 28,
                  boxShadow: "0 2px 10px rgba(28,49,86,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 850,
                    color: "#233555",
                    marginBottom: 18,
                  }}
                >
                  Selection consistency
                </div>

                {!result ? (
                  <div style={{ color: "#546884", fontSize: 14, lineHeight: 1.75 }}>
                    This reflects how similar your bruise boundary selections were across repeated
                    passes.
                    <br />
                    Higher consistency usually means the bruise boundary was easier to identify.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        color: "#546884",
                        fontSize: 14,
                        lineHeight: 1.75,
                        marginBottom: 22,
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>{result.consistencyMeaningLines[0]}</div>
                      <div>{result.consistencyMeaningLines[1]}</div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: 26,
                        alignItems: "start",
                      }}
                    >
                      {["Low", "Moderate", "High"].map((label, idx) => {
                        const active = consistencyIndex(result.consistencyLabel) === idx;
                        const innerScale = idx === 0 ? 0.62 : idx === 1 ? 0.84 : 0.95;

                        return (
                          <div
                            key={label}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "flex-start",
                            }}
                          >
                            <div
                              style={{
                                width: 106,
                                height: 106,
                                borderRadius: "50%",
                                background: "#f2d78a",
                                position: "relative",
                              }}
                            >
                              <div
                                style={{
                                  position: "absolute",
                                  inset: 7,
                                  borderRadius: "50%",
                                  background: "#6bb7df",
                                }}
                              />
                              <div
                                style={{
                                  position: "absolute",
                                  left: "50%",
                                  top: "50%",
                                  width: 106 * innerScale,
                                  height: 106 * innerScale,
                                  transform: "translate(-50%, -50%)",
                                  borderRadius: "50%",
                                  background: "#7b7ee0",
                                }}
                              />
                            </div>

                            <div
                              className="analysis-pill"
                              style={{
                                marginTop: 18,
                                minWidth: 92,
                                textAlign: "center",
                                padding: "9px 18px",
                                borderRadius: 999,
                                border: active ? "3px solid #ef4423" : "1px solid #bfd0e6",
                                background: "#ffffff",
                                fontWeight: active ? 800 : 500,
                                fontSize: 14,
                                color: "#334766",
                                boxShadow: active ? "0 2px 8px rgba(239,68,35,0.08)" : "none",
                              }}
                            >
                              {label}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d9e2ef",
                  borderRadius: 18,
                  padding: 28,
                  boxShadow: "0 2px 10px rgba(28,49,86,0.06)",
                  color: "#546884",
                  lineHeight: 1.75,
                  fontSize: 14,
                }}
              >
                <div
                  style={{
                    fontWeight: 850,
                    color: "#233555",
                    marginBottom: 12,
                    fontSize: 19,
                  }}
                >
                  Analysis note
                </div>
                This tool provides an image-based interpretation only and does not diagnose a
                medical condition. Lighting, skin tone, camera quality, and selection choices can
                affect the result. Repeat photos taken 24 hours or more apart are more useful for
                recovery tracking.
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}