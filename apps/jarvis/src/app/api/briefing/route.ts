import { NextResponse } from 'next/server';
import { getJarvisStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getJarvisStore();
  return NextResponse.json(store.briefing());
}

export async function POST(req: Request) {
  const body = (await req.json()) as { key?: string; value?: string };
  if (!body.key || body.value === undefined) {
    return NextResponse.json({ error: 'key_and_value_required' }, { status: 400 });
  }
  const store = await getJarvisStore();
  const fact = store.remember(body.key, body.value);
  await store.persist();
  return NextResponse.json({ fact });
}
