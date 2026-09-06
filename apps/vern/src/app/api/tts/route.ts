import { NextResponse } from 'next/server';
import { Communicate } from 'edge-tts-universal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Curated free Microsoft Edge neural voices (no API key). */
export const VERN_VOICES = [
  { id: 'en-US-GuyNeural', label: 'Guy · US (calm CFO)' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · UK' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher · US' },
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat · India' },
  { id: 'en-US-JennyNeural', label: 'Jenny · US' },
  { id: 'en-IN-NeerjaNeural', label: 'Neerja · India' },
] as const;

const ALLOWED = new Set(VERN_VOICES.map((v) => v.id));

export async function GET() {
  return NextResponse.json({ voices: VERN_VOICES, defaultVoice: 'en-US-GuyNeural' });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string; voice?: string };
    const text = (body.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 450);
    if (!text) {
      return NextResponse.json({ error: 'text_required' }, { status: 400 });
    }
    const voice =
      body.voice && ALLOWED.has(body.voice as (typeof VERN_VOICES)[number]['id'])
        ? body.voice
        : 'en-US-GuyNeural';

    const communicate = new Communicate(text, {
      voice,
      rate: '+2%',
      pitch: '-2Hz',
    });

    const parts: Buffer[] = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        parts.push(Buffer.from(chunk.data));
      }
    }

    if (parts.length === 0) {
      return NextResponse.json({ error: 'no_audio' }, { status: 502 });
    }

    const audio = Buffer.concat(parts);
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tts_failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
