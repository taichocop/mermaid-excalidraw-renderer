import { defineConfig } from "vitest/config";

export default defineConfig({ resolve: { alias: { obsidian: new URL("./tests/unit/obsidian-stub.ts", import.meta.url).pathname } }, test: { include: ["tests/unit/**/*.test.ts"] } });
