import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "ORBIT — Merchant Compliance & Risk Intelligence", short_name: "ORBIT", description: "Continuous compliance intelligence for modern commerce.", start_url: "/", display: "standalone", background_color: "#08090b", theme_color: "#08090b", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] };
}
