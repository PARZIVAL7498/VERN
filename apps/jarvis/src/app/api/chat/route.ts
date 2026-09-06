import { NextResponse } from 'next/server';
import { runJarvisChat } from '@vern/jarvis-core';
import { getJarvisStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as { message?: string };
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: 'message_required' }, { status: 400 });
  }
  const store = await getJarvisStore();
  const result = await runJarvisChat(store, message);
  return NextResponse.json(result);
}
