"use client";

import { useRef, useState } from "react";

type ToolMode = "move" | "bruise" | "erase";

export default function Home() {
  const frameSize = 560;

  const [image, setImage] = useState<string | null>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState({ width: 0, height: 0 });
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const [toolMode, setToolMode] = useState<ToolMode>("move");
  const [bruiseBrushSize, setBruiseBrushSize] = useState(28);
  const [eraseBrushSize, setEraseBrushSize] = useState(24);

  const [draggingImage, setDraggingImage] = useState(false);
  const [painting, setPainting] = useState(false);

  const [analysisText, setAnalysisText] = useState(
    "Upload a photo, adjust it if needed, mark the bruise area, then click Analyze."
  );

  const [result, setResult] = useState<{
    roiPixels: number;
    corePixels: number;
    coreRatio: number;
    avgR: number;
    avgG: number;
    avgB: number;
    severity: string;
    areaLevel: string;
    darknessLevel: string;
    summary: string;
  } | null>(null);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetStartRef = useRef({ x: 0, y: 0 });

  const imgRef = useRef<HTMLImageElement | null>(null);
  const roiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function getDisplayedSize(currentZoom: number, natural = imgNaturalSize) {
    if (!natural.width || !natural.height) {
      return { width: frameSize * currentZoom, height: frameSize * currentZoom };
    }

    const scaleToCover = Math.max(
      frameSize / natural.width,
      frameSize / natural.height
    );

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

    const minX = Math.min(0, frameSize - displayed.width);
    const maxX = 0;
    const minY = Math.min(0, frameSize - displayed.height);
    const maxY = 0;

    return {
      x: Math.max(minX, Math.min(maxX, nextX)),
      y: Math.max(minY, Math.min(maxY, nextY)),
    };
  }

  function centerImage(currentZoom: number, natural = imgNaturalSize) {
    const displayed = getDisplayedSize(currentZoom, natural);

    return clampOffset(
      (frameSize - displayed.width) / 2,
      (frameSize - displayed.height) / 2,
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

    const frameCenterX = frameSize / 2;
    const frameCenterY = frameSize / 2;

    const imagePointX = (frameCenterX - currentOffset.x) / prevSize.width;
    const imagePointY = (frameCenterY - currentOffset.y) / prevSize.height;

    const rawX = frameCenterX - imagePointX * nextSize.width;
    const rawY = frameCenterY - imagePointY * nextSize.height;

    return clampOffset(rawX, rawY, nextZoom, natural);
  }

  function clearOverlay() {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, frameSize, frameSize);
  }

  function clearMask() {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, frameSize, frameSize);
    clearOverlay();
  }

  function redrawOverlay() {
    const mask = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!mask || !overlay) return;

    const maskCtx = mask.getContext("2d", { willReadFrequently: true });
    const overlayCtx = overlay.getContext("2d");
    if (!maskCtx || !overlayCtx) return;

    const img = maskCtx.getImageData(0, 0, frameSize, frameSize).data;
    overlayCtx.clearRect(0, 0, frameSize, frameSize);

    for (let y = 0; y < frameSize; y += 2) {
      for (let x = 0; x < frameSize; x += 2) {
        const i = (y * frameSize + x) * 4;
        if (img[i + 3] < 10) continue;

        overlayCtx.fillStyle = "rgba(0, 120, 255, 0.16)";
        overlayCtx.fillRect(x, y, 2, 2);

        if (x % 6 === 0 && y % 6 === 0) {
          overlayCtx.fillStyle = "rgba(0, 120, 255, 0.42)";
          overlayCtx.beginPath();
          overlayCtx.arc(x + 1, y + 1, 0.7, 0, Math.PI * 2);
          overlayCtx.fill();
        }
      }
    }
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

    roiCanvas.width = frameSize;
    roiCanvas.height = frameSize;
    ctx.clearRect(0, 0, frameSize, frameSize);
    ctx.drawImage(img, imgOffset.x, imgOffset.y, displayed.width, displayed.height);

    return ctx;
  }

  function getAreaLevel(roiPixels: number) {
    if (roiPixels < 18000) return "Small";
    if (roiPixels < 60000) return "Medium";
    return "Large";
  }

  function getDarknessLevel(avgR: number, avgG: number, avgB: number) {
    const lum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
    if (lum > 95) return "Light";
    if (lum > 70) return "Medium";
    return "Deep";
  }

  function getSummary(severity: string, darknessLevel: string, areaLevel: string) {
    if (severity === "Strong") {
      return "The bruise appears strongly visible in the selected area.";
    }
    if (severity === "Moderate" && darknessLevel === "Deep") {
      return "The bruise appears clearly visible with a darker core.";
    }
    if (severity === "Moderate") {
      return "The bruise appears moderately visible.";
    }
    if (areaLevel === "Large") {
      return "The bruise appears spread out but not deeply concentrated.";
    }
    return "The bruise appears mildly visible in the selected area.";
  }

  function analyzeBruise() {
    const roiCtx = drawCurrentViewToCanvas();
    const maskCanvas = maskCanvasRef.current;
    if (!roiCtx || !maskCanvas) return;

    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!maskCtx) return;

    const roiData = roiCtx.getImageData(0, 0, frameSize, frameSize).data;
    const maskData = maskCtx.getImageData(0, 0, frameSize, frameSize).data;

    let roiPixels = 0;
    let sumLum = 0;
    const selectedPixels: Array<{ r: number; g: number; b: number; lum: number }> = [];

    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const i = (y * frameSize + x) * 4;
        if (maskData[i + 3] < 10) continue;

        const r = roiData[i];
        const g = roiData[i + 1];
        const b = roiData[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        roiPixels++;
        sumLum += lum;
        selectedPixels.push({ r, g, b, lum });
      }
    }

    if (roiPixels < 20) {
      setResult(null);
      setAnalysisText("Brush more of the bruise area before analyzing.");
      return;
    }

    const avgLum = sumLum / roiPixels;

    const corePixels = selectedPixels.filter((p) => p.lum < avgLum * 0.85);
    const finalCore =
      corePixels.length > 10
        ? corePixels
        : selectedPixels.filter((p) => p.lum < avgLum * 0.92);

    if (finalCore.length === 0) {
      setResult(null);
      setAnalysisText(
        "Could not isolate a darker bruise core. Try brushing a clearer bruise area."
      );
      return;
    }

    let sr = 0;
    let sg = 0;
    let sb = 0;

    for (const p of finalCore) {
      sr += p.r;
      sg += p.g;
      sb += p.b;
    }

    const avgR = Math.round(sr / finalCore.length);
    const avgG = Math.round(sg / finalCore.length);
    const avgB = Math.round(sb / finalCore.length);

    const coreRatioRaw = finalCore.length / roiPixels;
    const coreRatio = Number((coreRatioRaw * 100).toFixed(1));

    let severity = "Mild";
    if (coreRatioRaw > 0.55) severity = "Strong";
    else if (coreRatioRaw > 0.32) severity = "Moderate";

    const areaLevel = getAreaLevel(roiPixels);
    const darknessLevel = getDarknessLevel(avgR, avgG, avgB);
    const summary = getSummary(severity, darknessLevel, areaLevel);

    setResult({
      roiPixels,
      corePixels: finalCore.length,
      coreRatio,
      avgR,
      avgG,
      avgB,
      severity,
      areaLevel,
      darknessLevel,
      summary,
    });

    setAnalysisText(
      "Analysis complete. The darker bruise core was measured inside your selected region."
    );
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

  function renderLevelDots(level: number) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: n <= level ? "#2962ff" : "#d9d9d9",
            }}
          />
        ))}
      </div>
    );
  }

  const displayed = getDisplayedSize(zoom);

  const bruiseActive = toolMode === "bruise";
  const eraseActive = toolMode === "erase";

  const severityLevel =
    result?.severity === "Strong" ? 5 : result?.severity === "Moderate" ? 3 : 2;
  const areaLevelDots =
    result?.areaLevel === "Large" ? 5 : result?.areaLevel === "Medium" ? 3 : 2;
  const darknessLevelDots =
    result?.darknessLevel === "Deep" ? 5 : result?.darknessLevel === "Medium" ? 3 : 2;

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "Arial",
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: 6 }}>BruiseTrace</h1>
      <p style={{ marginTop: 0, marginBottom: 18 }}>
        Inclusive skin signal measurement system
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "760px 540px",
          gap: 40,
          alignItems: "start",
        }}
      >
        <section>
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "end",
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <label
              style={{
                background: "#111",
                color: "white",
                padding: "12px 20px",
                cursor: "pointer",
                fontWeight: 700,
                borderRadius: 8,
              }}
            >
              Upload Photo
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const url = URL.createObjectURL(file);
                  const tempImg = new Image();

                  tempImg.onload = () => {
                    const natural = {
                      width: tempImg.naturalWidth,
                      height: tempImg.naturalHeight,
                    };

                    setImage(url);
                    setImgNaturalSize(natural);

                    const initialZoom = 1;
                    setZoom(initialZoom);
                    setImgOffset(centerImage(initialZoom, natural));
                    setResult(null);
                    setToolMode("move");
                    setAnalysisText(
                      "Adjust the photo if needed, then select Bruise Brush."
                    );

                    setTimeout(() => {
                      clearMask();
                    }, 0);
                  };

                  tempImg.src = url;
                }}
              />
            </label>

            <div style={{ minWidth: 240 }}>
              <div style={{ fontSize: 14, marginBottom: 6 }}>Zoom</div>
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
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 16,
              alignItems: "start",
              marginBottom: 18,
              maxWidth: 724,
            }}
          >
            <div>
              <button
                onClick={() => setToolMode("bruise")}
                style={{
                  width: "100%",
                  height: 52,
                  padding: "11px 14px",
                  background: bruiseActive ? "#2962ff" : "#f2f2f2",
                  color: bruiseActive ? "white" : "black",
                  border: "1px solid #d0d0d0",
                  fontWeight: 700,
                  borderRadius: 8,
                  marginBottom: 8,
                }}
              >
                Bruise Brush
              </button>
              <input
                type="range"
                min="10"
                max="70"
                step="1"
                value={bruiseBrushSize}
                onChange={(e) => setBruiseBrushSize(Number(e.target.value))}
                disabled={!bruiseActive}
                style={{
                  width: "100%",
                  opacity: bruiseActive ? 1 : 0.35,
                }}
              />
            </div>

            <div>
              <button
                onClick={() => setToolMode("erase")}
                style={{
                  width: "100%",
                  height: 52,
                  padding: "11px 14px",
                  background: eraseActive ? "#333" : "#f2f2f2",
                  color: eraseActive ? "white" : "black",
                  border: "1px solid #d0d0d0",
                  fontWeight: 700,
                  borderRadius: 8,
                  marginBottom: 8,
                }}
              >
                Erase
              </button>
              <input
                type="range"
                min="10"
                max="70"
                step="1"
                value={eraseBrushSize}
                onChange={(e) => setEraseBrushSize(Number(e.target.value))}
                disabled={!eraseActive}
                style={{
                  width: "100%",
                  opacity: eraseActive ? 1 : 0.35,
                }}
              />
            </div>

            <div>
              <button
                onClick={() => {
                  clearMask();
                  setResult(null);
                  setToolMode("move");
                  setAnalysisText("Selection cleared. Adjust or brush again.");
                }}
                style={{
                  width: "100%",
                  height: 52,
                  padding: "12px 18px",
                  background: "#f2f2f2",
                  border: "1px solid #d0d0d0",
                  fontWeight: 700,
                  borderRadius: 8,
                  marginBottom: 8,
                }}
              >
                Clear Selection
              </button>
              <div style={{ height: 22 }} />
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <button
              onClick={analyzeBruise}
              disabled={!image}
              style={{
                padding: "13px 26px",
                background: image ? "#0a7f3f" : "#cfcfcf",
                color: "white",
                border: "none",
                cursor: image ? "pointer" : "default",
                fontWeight: 800,
                borderRadius: 8,
                fontSize: 16,
              }}
            >
              Analyze
            </button>
          </div>

          <div
            style={{
              width: frameSize,
              height: frameSize,
              border: "2px solid #d9d9d9",
              overflow: "hidden",
              position: "relative",
              background: "#f5f5f5",
              userSelect: "none",
              borderRadius: 12,
            }}
            onMouseDown={(e) => {
              if (!image) return;

              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;

              if (toolMode === "move") {
                startMove(e.clientX, e.clientY);
              } else {
                setPainting(true);
                drawBrush(x, y);
              }
            }}
            onMouseMove={(e) => {
              if (!image) return;

              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;

              if (toolMode === "move") {
                moveImage(e.clientX, e.clientY);
              } else if (painting) {
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
            }}
          >
            {image ? (
              <>
                <img
                  ref={imgRef}
                  src={image}
                  draggable={false}
                  style={{
                    position: "absolute",
                    left: imgOffset.x,
                    top: imgOffset.y,
                    width: displayed.width,
                    height: displayed.height,
                    maxWidth: "none",
                    cursor:
                      toolMode === "move"
                        ? draggingImage
                          ? "grabbing"
                          : "grab"
                        : "crosshair",
                  }}
                />

                <canvas
                  ref={overlayCanvasRef}
                  width={frameSize}
                  height={frameSize}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    pointerEvents: "none",
                  }}
                />

                <canvas
                  ref={maskCanvasRef}
                  width={frameSize}
                  height={frameSize}
                  style={{ display: "none" }}
                />
              </>
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: 40,
                  color: "#555",
                }}
              >
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>
                    Upload a bruise photo
                  </div>
                  <div style={{ marginTop: 10, fontSize: 16 }}>
                    Adjust first, brush second, analyze last.
                  </div>
                </div>
              </div>
            )}

            {image && (
              <div
                style={{
                  position: "absolute",
                  bottom: 16,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.45)",
                  color: "white",
                  padding: "7px 14px",
                  fontSize: 13,
                  borderRadius: 8,
                }}
              >
                {toolMode === "move"
                  ? "Move mode: drag image"
                  : toolMode === "bruise"
                  ? "Bruise mode: brush the bruise area"
                  : "Erase mode: remove extra selection"}
              </div>
            )}
          </div>

          <canvas
            ref={roiCanvasRef}
            width={frameSize}
            height={frameSize}
            style={{ display: "none" }}
          />
        </section>

        <aside>
          <div
            style={{
              border: "1px solid #ddd",
              padding: 24,
              borderRadius: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>Analysis</h2>
            <p style={{ marginTop: 0, lineHeight: 1.45 }}>{analysisText}</p>

            {!result && (
              <ul style={{ lineHeight: 1.6, paddingLeft: 22, marginBottom: 0 }}>
                <li>ROI area = the region you brushed</li>
                <li>Bruise core = darker pixels inside your brushed region</li>
                <li>Area and severity are separated on purpose</li>
              </ul>
            )}

            {result && (
              <>
                <div
                  style={{
                    display: "inline-block",
                    padding: "8px 12px",
                    borderRadius: 999,
                    background:
                      result.severity === "Strong"
                        ? "#ffe4e6"
                        : result.severity === "Moderate"
                        ? "#fff3cd"
                        : "#e8f5e9",
                    color:
                      result.severity === "Strong"
                        ? "#b42318"
                        : result.severity === "Moderate"
                        ? "#8a5a00"
                        : "#166534",
                    fontWeight: 800,
                    marginBottom: 14,
                  }}
                >
                  {result.severity} visibility
                </div>

                <div
                  style={{
                    padding: 18,
                    background: "#f7f7f7",
                    border: "1px solid #e5e5e5",
                    borderRadius: 12,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {result.summary}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "150px 1fr 90px",
                      gap: 12,
                      alignItems: "center",
                      rowGap: 14,
                      marginTop: 14,
                    }}
                  >
                    <div>Overall visibility</div>
                    {renderLevelDots(severityLevel)}
                    <div style={{ fontWeight: 700 }}>{result.severity}</div>

                    <div>Core darkness</div>
                    {renderLevelDots(darknessLevelDots)}
                    <div style={{ fontWeight: 700 }}>{result.darknessLevel}</div>

                    <div>Selected area</div>
                    {renderLevelDots(areaLevelDots)}
                    <div style={{ fontWeight: 700 }}>{result.areaLevel}</div>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        border: "1px solid #d0d0d0",
                        background: `rgb(${result.avgR}, ${result.avgG}, ${result.avgB})`,
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 700 }}>Core bruise color</div>
                      <div style={{ color: "#555" }}>
                        RGB {result.avgR}, {result.avgG}, {result.avgB}
                      </div>
                    </div>
                  </div>
                </div>

                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                    Show numeric details
                  </summary>
                  <div
                    style={{
                      marginTop: 12,
                      padding: 14,
                      background: "#fafafa",
                      border: "1px solid #ececec",
                      borderRadius: 10,
                      lineHeight: 1.7,
                    }}
                  >
                    <div><b>ROI Pixels:</b> {result.roiPixels}</div>
                    <div><b>Bruise Core Pixels:</b> {result.corePixels}</div>
                    <div><b>Core Ratio:</b> {result.coreRatio}%</div>
                  </div>
                </details>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}