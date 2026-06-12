import os from 'os';

/** @type {import('next').NextConfig} */
const networkInterfaces = os.networkInterfaces();
const localIps = Object.values(networkInterfaces)
  .flat()
  .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
  .map((iface) => iface.address);

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: [
    ...localIps, 
    ...localIps.map(ip => `${ip}:3000`),
    'localhost:3000',
    '127.0.0.1:3000'
  ],
}

export default nextConfig
