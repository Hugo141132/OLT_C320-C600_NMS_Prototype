import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Ambil backend URL dari environment (runtime)
  const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8765';

  // Pastikan request mengarah ke /api/ atau /ws/
  if (
    request.nextUrl.pathname.startsWith('/api/') ||
    request.nextUrl.pathname.startsWith('/ws/')
  ) {
    // Bangun URL tujuan ke backend
    const destinationUrl = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      backendUrl
    );

    // Lakukan rewrite (proxy) ke backend
    return NextResponse.rewrite(destinationUrl);
  }

  return NextResponse.next();
}

// Batasi middleware hanya berjalan di path API dan WebSocket
export const config = {
  matcher: ['/api/:path*', '/ws/:path*'],
};
