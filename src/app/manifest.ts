import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cragdiary",
    short_name: "Cragdiary",
    description: "A shared climbing journal — days on rock, written down.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3e8d8",
    theme_color: "#f3e8d8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
