import { defineConfig } from "vitest/config";
import path from "node:path";

// Route handlers import through the tsconfig "@/" alias; Vite doesn't read
// tsconfig paths on its own.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
