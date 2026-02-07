import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ws': { target: 'http://localhost:8000', ws: true },
      '/api': 'http://localhost:8000',
      '/mcp': 'http://localhost:8000',
    },
  },
})
