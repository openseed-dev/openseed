import { defineConfig } from "vitest/config";
import path from 'node:path';

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      '@true-and-useful/janee': path.resolve(__dirname, 'src/__mocks__/@true-and-useful/janee.ts'),
    },
  },
});
