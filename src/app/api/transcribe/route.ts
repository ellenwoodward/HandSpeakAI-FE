// app/api/transcribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";

// Ensure the runtime is nodejs (we need fs); omit if you prefer default.
// export const runtime = "nodejs"; 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Write the uploaded file to a temp path (Whisper needs a readable stream)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const tmpPath = path.join(
      os.tmpdir(),
      // Preserve extension if present (helps Whisper infer format)
      file.name || `upload_${Date.now()}.webm`
    );
    fs.writeFileSync(tmpPath, buffer);

    // Send to Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
    });

    // Cleanup
    try { fs.unlinkSync(tmpPath); } catch {}

    return NextResponse.json({ text: transcription.text ?? "" });
  } catch (err: any) {
    console.error("Transcription error:", err);
    return NextResponse.json(
      { error: err?.message || "Transcription failed" },
      { status: 500 }
    );
  }
}
