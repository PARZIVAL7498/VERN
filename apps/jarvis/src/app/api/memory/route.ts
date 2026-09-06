import { NextResponse } from 'next/server';
import { getJarvisStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getJarvisStore();
  return NextResponse.json({
    facts: store.state.facts,
    notes: store.state.notes,
    reminders: store.state.reminders,
    conversation: store.state.conversation.slice(-20),
  });
}
