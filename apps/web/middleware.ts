import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fullJitterBackoffMs } from '@orbital-stellar/pulse-core/src/backoff';

const rateLimitMap = new Map<string, { count: number, resetTime: number }>();

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/registry')) {
    const ip = request.ip ?? '127.0.0.1';
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 100;
    
    let record = rateLimitMap.get(ip);
    if (!record || record.resetTime < now) {
      record = { count: 0, resetTime: now + windowMs };
    }
    
    record.count++;
    rateLimitMap.set(ip, record);

    if (record.count > maxRequests) {
      const retryAfter = fullJitterBackoffMs(record.count - maxRequests, 1000, 30000) / 1000;
      return new NextResponse('Rate Limit Exceeded', {
        status: 429,
        headers: {
          'Retry-After': retryAfter.toString(),
          'X-Served-From': 'stale'
        }
      });
    }
    
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    return res;
  }
}

export const config = {
  matcher: '/api/registry/:path*',
};
