import { NextResponse } from 'next/server';
import { runVernCfoChat } from '@vern/core';
import { getCompanyStore, getPersonalStore } from '@/lib/stores';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as { message?: string };
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: 'message_required' }, { status: 400 });
  }
  const company = await getCompanyStore();
  const personal = await getPersonalStore();
  const result = await runVernCfoChat(company, personal, message);
  return NextResponse.json(result);
}
