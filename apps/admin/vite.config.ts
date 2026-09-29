import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174, proxy: { '/api': process.env.VITE_API_TARGET || 'http://127.0.0.1:3000' } },
})
