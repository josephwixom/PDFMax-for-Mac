import type { NextConfig } from "next";

const isCapacitor = process.env.CAPACITOR === '1';
const isElectron = process.env.ELECTRON === '1';

const nextConfig: NextConfig = {
  transpilePackages: ['@pdfmax/pdf-engine', '@pdfmax/shared'],
  turbopack: {},
  // Static export for Capacitor (iOS/Android) or Electron (macOS desktop)
  ...((isCapacitor || isElectron) && {
    output: 'export',
    images: { unoptimized: true },
  }),
};

export default nextConfig;
