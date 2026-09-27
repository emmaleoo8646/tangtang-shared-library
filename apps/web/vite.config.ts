import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  server: { proxy: { '/api': process.env.VITE_API_TARGET || 'http://127.0.0.1:3000' } },
})
