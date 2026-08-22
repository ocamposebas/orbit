import { ImageResponse } from "next/og";

export const alt = "ORBIT — Merchant Compliance & Risk Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#08090b", color: "#f2f0eb", padding: 72, fontFamily: "Arial, sans-serif", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, opacity: .2, backgroundImage: "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)", backgroundSize: "48px 48px" }}/>
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, letterSpacing: 8, fontWeight: 700 }}><div style={{ display: "flex", width: 38, height: 38, border: "1px solid #555764", borderRadius: 99, alignItems: "center", justifyContent: "center" }}><div style={{ width: 8, height: 8, borderRadius: 99, background: "#9293ff" }}/></div>ORBIT</div>
      <div style={{ display: "flex", flexDirection: "column" }}><div style={{ display: "flex", flexDirection: "column", fontSize: 82, lineHeight: .98, letterSpacing: -5, fontWeight: 600 }}><span>Stay ahead</span><span style={{ color: "#9a9ca6" }}>of merchant risk.</span></div><div style={{ marginTop: 28, fontSize: 23, color: "#8f929b" }}>Continuous merchant compliance monitoring and risk intelligence.</div></div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: "#6d7078" }}><span>Merchant Compliance &amp; Risk Intelligence</span><span>Independent B2B software</span></div>
    </div>, size,
  );
}
