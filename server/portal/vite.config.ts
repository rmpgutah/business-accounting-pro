import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The portal SPA is mounted at https://<host>/portal/ on the VPS —
  // without this, built assets reference absolute root paths
  // (/assets/*.js) which the Express server doesn't handle. Setting
  // base rewrites every asset URL during build to /portal/assets/*.js
  // so they resolve correctly behind the reverse proxy.
  base: '/portal/',
})
