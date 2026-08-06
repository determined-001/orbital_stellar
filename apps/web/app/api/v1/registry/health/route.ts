import { NextResponse } from 'next/server';

export async function GET() {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'hosted-api-registry',
  };

  return NextResponse.json(healthCheck, { status: 200 });
}