"use client";

import { useRef, useState } from "react";

type ComponentStats = {
  pixels: number[];
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerDistAvg: number;
};

export default function Home() {
  const frameSize = 560;

  const [image, setImage] = useState<string | null>(null);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [draggingImage, setDraggingImage] = useState(false);

  const [analysisText, setAnalysisText] = useState(
    "Center the bruise, then click Detect Bruise."
  );
  const [detected, setDetected] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const startOffsetRef = useRef({ x: 0, y: 0 });

  const imgRef = useRef<HTMLImageElement | null>(null);
  const roiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function startDrag(clientX: number, clientY: number) {
    if (!image) return;
    setDraggingImage(true);
    dragStartRef.current = { x: clientX, y: clientY };
    startOffsetRef.current = { ...imgOffset };
  }

  function moveDrag(clientX: number, clientY: number) {
    if (!draggingImage) return;

    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;

    setImgOffset({
      x: startOffsetRef.current.x + dx,
      y: startOffsetRef.current.y + dy,
    });
  }

  function endDrag() {
    setDraggingImage(false);
  }

  function clearOverlay() {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    overlay.width = frameSize;
    overlay.height = frameSize;
    ctx.clearRect(0, 0, frameSize, frameSize);
  }

  function drawCurrentViewToCanvas() {
    const img = imgRef.current;
    const roiCanvas = roiCanvasRef.current;
    if (!img || !roiCanvas) return null;

    const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    roiCanvas.width = frameSize;
    roiCanvas.height = frameSize;
    ctx.clearRect(0, 0, frameSize, frameSize);
    ctx.drawImage(img, imgOffset.x, imgOffset.y, frameSize * zoom, frameSize * zoom);

    return ctx;
  }

  function getConnectedComponents(
    candidateMask: Uint8Array,
    width: number,
    height: number
  ) {
    const visited = new Uint8Array(width * height);
    const components: ComponentStats[] = [];
    const cx = width / 2;
    const cy = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const startIdx = y * width + x;
        if (!candidateMask[startIdx] || visited[startIdx]) continue;

        const queue: number[] = [startIdx];
        visited[startIdx] = 1;

        const pixels: number[] = [];
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let distSum = 0;

        while (queue.length) {
          const idx = queue.shift()!;
          const px = idx % width;
          const py = Math.floor(idx / width);

          pixels.push(idx);

          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;

          const dx = px - cx;
          const dy = py - cy;
          distSum += Math.sqrt(dx * dx + dy * dy);

          const neighbors = [
            [px + 1, py],
            [px - 1, py],
            [px, py + 1],
            [px, py - 1],
            [px + 1, py + 1],
            [px - 1, py - 1],
            [px + 1, py - 1],
            [px - 1, py + 1],
          ];

          for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nidx = ny * width + nx;
            if (!candidateMask[nidx] || visited[nidx]) continue;
            visited[nidx] = 1;
            queue.push(nidx);
          }
        }

        components.push({
          pixels,
          count: pixels.length,
          minX,
          maxX,
          minY,
          maxY,
          centerDistAvg: distSum / pixels.length,
        });
      }
    }

    return components;
  }

  function detectBruise() {
    const ctx = drawCurrentViewToCanvas();
    if (!ctx) return;

    const overlay = overlayCanvasRef.current;
    if (!overlay) return;

    const octx = overlay.getContext("2d");
    if (!octx) return;

    overlay.width = frameSize;
    overlay.height = frameSize;
    octx.clearRect(0, 0, frameSize, frameSize);

    const imageData = ctx.getImageData(0, 0, frameSize, frameSize);
    const data = imageData.data;

    const centerX = frameSize / 2;
    const centerY = frameSize / 2;

    // 1) ROI 바깥 테두리에서 피부 기준값 추정
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let count = 0;

    const border = Math.floor(frameSize * 0.14);

    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const inBorder =
          x < border ||
          y < border ||
          x > frameSize - border ||
          y > frameSize - border;

        if (!inBorder) continue;

        const i = (y * frameSize + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // 극단적으로 어둡거나 너무 붉은 영역 제외
        if (lum > 65 && g > 40 && r < 245 && g < 245 && b < 245) {
          sr += r;
          sg += g;
          sb += b;
          count++;
        }
      }
    }

    if (count === 0) {
      setDetected(false);
      setAnalysisText("Could not estimate nearby skin. Try another photo.");
      return;
    }

    const skinR = sr / count;
    const skinG = sg / count;
    const skinB = sb / count;
    const skinLum = 0.299 * skinR + 0.587 * skinG + 0.114 * skinB;

    // 2) 픽셀별 bruise-like candidate
    const candidateMask = new Uint8Array(frameSize * frameSize);

    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const i = (y * frameSize + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 중심에서 너무 멀면 아예 제외
        if (dist > frameSize * 0.34) continue;

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const diff =
          Math.abs(r - skinR) + Math.abs(g - skinG) + Math.abs(b - skinB);

        const darker = skinLum - lum;
        const purpleBias = ((r + b) / 2) - g;
        const redBlueStrong = Math.max(r - g, 0) + Math.max(b - g, 0);

        const isBruiseLike =
          diff > 62 &&
          darker > 8 &&
          (purpleBias > 6 || redBlueStrong > 18);

        if (isBruiseLike) {
          candidateMask[y * frameSize + x] = 1;
        }
      }
    }

    const components = getConnectedComponents(candidateMask, frameSize, frameSize);

    if (components.length === 0) {
      setDetected(false);
      setAnalysisText(
        "No clear bruise candidate found. Re-center the bruise and try again."
      );
      return;
    }

    // 3) 가장 그럴듯한 덩어리 선택
    let best: ComponentStats | null = null;
    let bestScore = -Infinity;

    for (const comp of components) {
      if (comp.count < 120) continue;

      const width = comp.maxX - comp.minX + 1;
      const height = comp.maxY - comp.minY + 1;
      const boxArea = width * height;
      const fillRatio = comp.count / boxArea;
      const aspect = width > height ? width / height : height / width;

      // 너무 가늘고 긴 덩어리는 버림
      if (aspect > 3.2) continue;

      const compactnessBonus = fillRatio * 140;
      const sizeBonus = Math.min(comp.count / 18, 120);
      const centerBonus = Math.max(0, 150 - comp.centerDistAvg);

      const score = compactnessBonus + sizeBonus + centerBonus;

      if (score > bestScore) {
        bestScore = score;
        best = comp;
      }
    }

    if (!best) {
      setDetected(false);
      setAnalysisText(
        "Detection looks unstable. Try zooming in more and centering the bruise again."
      );
      return;
    }

    // 4) 오버레이 그리기
    let minX = frameSize;
    let minY = frameSize;
    let maxX = 0;
    let maxY = 0;

    for (const idx of best.pixels) {
      const x = idx % frameSize;
      const y = Math.floor(idx / frameSize);

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x % 3 === 0 && y % 3 === 0) {
        octx.fillStyle = "rgba(0, 120, 255, 0.15)";
        octx.fillRect(x, y, 3, 3);

        octx.fillStyle = "rgba(0, 120, 255, 0.42)";
        octx.beginPath();
        octx.arc(x + 1.5, y + 1.5, 0.8, 0, Math.PI * 2);
        octx.fill();
      }
    }

    // bounding hint
    octx.strokeStyle = "rgba(0,120,255,0.85)";
    octx.lineWidth = 2;
    octx.strokeRect(minX, minY, maxX - minX, maxY - minY);

    setDetected(true);
    setAnalysisText(
      "Possible bruise detected. If it looks right, continue. If not, re-center or zoom and detect again."
    );
  }

  function resetAll() {
    setImage(null);
    setImgOffset({ x: 0, y: 0 });
    setZoom(1);
    setDetected(false);
    setAnalysisText("Center the bruise, then click Detect Bruise.");
    clearOverlay();
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "Arial",
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <h1>BruiseTrace</h1>
      <p>Inclusive skin signal measurement system</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "720px 360px",
          gap: 40,
        }}
      >
        <section>
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              marginBottom: 20,
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                background: "#111",
                color: "white",
                padding: "12px 18px",
                cursor: "pointer",
                fontWeight: 600,
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
                  setImage(url);
                  setImgOffset({ x: 0, y: 0 });
                  setZoom(1);
                  setDetected(false);
                  setAnalysisText("Center the bruise, then click Detect Bruise.");
                  clearOverlay();
                }}
              />
            </label>

            <div>
              <div style={{ fontSize: 14 }}>Zoom</div>
              <input
                type="range"
                min="1"
                max="2.5"
                step="0.01"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                style={{ width: 220 }}
              />
            </div>

            <button
              onClick={detectBruise}
              disabled={!image}
              style={{
                padding: "12px 18px",
                background: image ? "#2962ff" : "#cfcfcf",
                color: "white",
                border: "none",
                cursor: image ? "pointer" : "default",
                fontWeight: 600,
              }}
            >
              Detect Bruise
            </button>

            <button
              onClick={resetAll}
              style={{
                padding: "12px 18px",
                background: "#f2f2f2",
                border: "1px solid #d0d0d0",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Reset
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
            }}
            onMouseDown={(e) => {
              if (!image) return;
              startDrag(e.clientX, e.clientY);
            }}
            onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onTouchStart={(e) => {
              if (!image) return;
              const touch = e.touches[0];
              startDrag(touch.clientX, touch.clientY);
            }}
            onTouchMove={(e) => {
              const touch = e.touches[0];
              moveDrag(touch.clientX, touch.clientY);
            }}
            onTouchEnd={endDrag}
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
                    width: frameSize * zoom,
                    height: frameSize * zoom,
                    objectFit: "cover",
                    cursor: draggingImage ? "grabbing" : "grab",
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
                  <div style={{ fontSize: 26, fontWeight: 700 }}>
                    Center the bruise on the +
                  </div>
                  <div style={{ marginTop: 10 }}>
                    Upload a photo and move the image so the bruise sits in the center.
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 30,
                height: 30,
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 0,
                  width: 2,
                  height: "100%",
                  background: "white",
                  transform: "translateX(-50%)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  width: "100%",
                  height: 2,
                  background: "white",
                  transform: "translateY(-50%)",
                }}
              />
            </div>

            {image && (
              <div
                style={{
                  position: "absolute",
                  bottom: 16,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.45)",
                  color: "white",
                  padding: "6px 12px",
                  fontSize: 13,
                }}
              >
                Drag and zoom to center the bruise
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
              padding: 20,
            }}
          >
            <h2>ROI Preview</h2>
            <p>{analysisText}</p>

            <ul>
              <li>analysis is limited to this square</li>
              <li>background noise is reduced</li>
              <li>the bruise stays near the center</li>
              <li>you can re-detect after re-centering</li>
            </ul>

            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: detected ? "#eef6ff" : "#f4f4f4",
              }}
            >
              {detected
                ? "Possible bruise area detected."
                : "Next step: detect the bruise inside this square."}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}