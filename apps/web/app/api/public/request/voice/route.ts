import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export async function POST(req: NextRequest) {
  const apiKey = String(process.env.ELEVENLABS_API_KEY ?? "").trim();
  const voiceId = String(process.env.ELEVENLABS_VOICE_ID ?? "").trim();

  if (!apiKey || !voiceId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Voice is not configured yet. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID."
      },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
  }

  const tts = await fetch(ELEVENLABS_URL + "/" + encodeURIComponent(voiceId) + "/stream", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
      accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: text.slice(0, 500),
      model_id: "eleven_multilingual_v2"
    })
  });

  if (!tts.ok) {
    return NextResponse.json({ ok: false, error: "Failed to generate voice response" }, { status: 502 });
  }

  const audio = await tts.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store"
    }
  });
}

