import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const eclipseData = await readFile(join(process.cwd(), "public/orbit-eclipse-violet-og.jpg"), "base64");
const eclipseSrc = `data:image/jpeg;base64,${eclipseData}`;

export const alt = "ORBIT - Continuous Merchant Risk Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#050611", color: "#f5f4ff", fontFamily: "Arial, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* ImageResponse uses a runtime image element rather than next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={eclipseSrc}
        alt=""
        width="1200"
        height="630"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,6,17,.98) 0%, rgba(5,6,17,.91) 44%, rgba(5,6,17,.18) 82%)" }} />
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", flexDirection: "column", justifyContent: "space-between", padding: "62px 68px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 18, fontWeight: 700 }}>
          <div style={{ display: "flex", width: 20, height: 20, border: "1px solid rgba(255,255,255,.45)", borderRadius: 99, position: "relative" }}>
            <div style={{ position: "absolute", right: -2, top: 0, width: 6, height: 6, borderRadius: 99, background: "#7c5cff" }} />
          </div>
          ORBIT
        </div>

        <div style={{ display: "flex", maxWidth: 760, flexDirection: "column" }}>
          <div style={{ display: "flex", color: "#a78bfa", fontSize: 15, fontWeight: 700, textTransform: "uppercase" }}>Merchant risk intelligence</div>
          <div style={{ display: "flex", marginTop: 22, flexDirection: "column", fontSize: 64, lineHeight: .95, fontWeight: 600 }}>
            <span>See merchant risk</span>
            <span>before disruption.</span>
          </div>
          <div style={{ display: "flex", marginTop: 24, maxWidth: 620, fontSize: 20, lineHeight: 1.35, color: "#b2b3c8" }}>
            Continuous monitoring, source evidence, and review history in one operating view.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#77736d", fontSize: 13 }}>
          <div style={{ display: "flex", width: 6, height: 6, borderRadius: 99, background: "#6ee7c3" }} />
          ALWAYS IN MOTION
        </div>
      </div>
    </div>,
    size,
  );
}
