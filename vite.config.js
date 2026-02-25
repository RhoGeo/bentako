import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Plain Vite config (Base44 removed)
export default defineConfig({
  logLevel: 'error',
  plugins: [react()],
});
