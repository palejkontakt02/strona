import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Aplikacja jest serwowana przez GitHub Pages pod sebastianpalej.pl/app/,
// a zbudowane pliki trafiają do katalogu /app w repozytorium.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
});
