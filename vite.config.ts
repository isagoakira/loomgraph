import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const excalidrawSubsetModules = [
  "/@excalidraw/excalidraw/dist/prod/subset-worker.chunk.js",
  "/@excalidraw/excalidraw/dist/prod/subset-shared.chunk.js",
  "/@excalidraw/excalidraw/dist/prod/chunk-EIO257PC.js",
  "/@excalidraw/excalidraw/dist/prod/chunk-ZUYEQ4TG.js",
  "/@excalidraw/excalidraw/dist/prod/chunk-SRAX5OIU.js",
];

function manualChunkForBrowserWorker(id: string): string | undefined {
  const normalized = id.replaceAll("\\", "/");
  return excalidrawSubsetModules.some((modulePath) => normalized.endsWith(modulePath))
    ? "excalidraw-subset-worker"
    : undefined;
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Excalidraw's font-subsetting worker imports a small shared module
        // set. Keep those modules together so Vite does not make the worker
        // import the DOM-bound application entry chunk.
        manualChunks: manualChunkForBrowserWorker,
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:4317" } },
});
