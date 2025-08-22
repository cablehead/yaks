import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'jsdom',
    globals: true,
    transformMode: {
      web: [/\.[jt]sx?$/]
    },
    server: {
      deps: {
        inline: [/solid-js/]
      }
    },
    threads: false,
    isolate: false
  },
  resolve: {
    conditions: ['browser', 'development', 'import', 'module', 'default']
  },
});