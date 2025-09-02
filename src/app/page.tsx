"use client";

import { useRef, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Button } from "@/components/ui/button";
import SockJS from "sockjs-client";

const MODEL_URL = "https://storage.googleapis.com/animations-handspeak-ai/character.glb";

function CharacterModel() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} scale={2} />;
}

export default function HomePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [socket, setSocket] = useState<ReturnType<typeof SockJS> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [receivedMessages, setReceivedMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState<null | "mic" | "file">(null);
  const [error, setError] = useState<string | null>(null);

  // ---- Setup WebSocket ----
  useEffect(() => {
    const sock = new WebSocket("wss://handspeak-backend-221849113631.europe-west1.run.app/ws");

    sock.onopen = () => console.log("WebSocket connection opened");
    sock.onclose = () => console.log("WebSocket connection closed");
    sock.onmessage = (e) => {
      console.log("Message received from backend:", e.data);
      setReceivedMessages((prev) => [...prev, e.data]);
    };

    setSocket(sock);

    return () => sock.close();
  }, []);

  const sendTranscriptToWS = (text: string) => {
    if (socket && text) {
      // Split by punctuation to send sentence by sentence (optional)
      const sentences = text.split(/[.?!]/).filter((s) => s.trim() !== "");
      sentences.forEach((sentence, i) =>
        setTimeout(() => {
          socket.send(sentence.trim());
          console.log("Sent to WS:", sentence.trim());
        }, i * 500)
      );
    }
  };

  // ---- File upload handler ----
  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setError(null);
      setTranscript(null);
      if (!e.target.files || !e.target.files[0]) return;

      const file = e.target.files[0];
      setLoading("file");

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/transcribe", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "Transcription failed");

      setTranscript(data.text || "(No text)");
      sendTranscriptToWS(data.text || "(No text)");
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setLoading(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ---- Microphone recording handler ----
  const handleMicToggle = async () => {
    if (!isRecording) {
      try {
        setError(null);
        setTranscript(null);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          try {
            setLoading("mic");
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            setAudioURL(url);

            const formData = new FormData();
            formData.append("file", new File([blob], "mic_recording.webm", { type: mimeType }));

            const res = await fetch("/api/transcribe", { method: "POST", body: formData });
            const data = await res.json();

            if (!res.ok) throw new Error(data?.error || "Transcription failed");

            setTranscript(data.text || "(No text)");
            sendTranscriptToWS(data.text || "(No text)");
          } catch (err: any) {
            setError(err.message || "Microphone transcription failed");
          } finally {
            setLoading(null);
            stream.getTracks().forEach((t) => t.stop());
          }
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        setIsRecording(true);
      } catch (err) {
        setError("Microphone access denied or unavailable");
        console.error(err);
      }
    } else {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="w-full border-b bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">HandSpeak AI</h1>
        </div>
      </header>

      {/* Controls */}
      <div className="bg-white border-b shadow-sm p-4 flex gap-4 justify-center">
        <Button onClick={handleUploadClick} disabled={loading !== null || isRecording}>
          {loading === "file" ? "Uploading…" : "Upload Audio/Video"}
        </Button>
        <input
          type="file"
          accept="audio/*,video/*"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <Button
          variant={isRecording ? "destructive" : "secondary"}
          onClick={handleMicToggle}
          disabled={loading !== null}
        >
          {isRecording ? "⏹ Stop & Transcribe" : "🎤 Start Mic Recording"}
        </Button>
      </div>

      {/* 3D Canvas */}
      <main className="flex-1 bg-gray-100 relative">
        <Canvas camera={{ position: [0, 1.5, 3] }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 3, 3]} intensity={1} />
          <CharacterModel />
          <OrbitControls enableZoom={true} />
        </Canvas>

        {/* Transcript card */}
        {transcript && (
          <div className="absolute bottom-24 right-4 bg-white shadow-md rounded-lg p-3 max-w-sm border">
            <p className="text-sm font-medium">📝 Transcription</p>
            <p className="text-gray-800 mt-2 text-sm whitespace-pre-wrap">{transcript}</p>
          </div>
        )}

        {/* Last recording */}
        {audioURL && (
          <div className="absolute bottom-4 right-4 bg-white shadow-md rounded-lg p-3 border">
            <p className="text-sm font-medium">🎧 Last Recording</p>
            <audio controls src={audioURL} className="mt-2 w-64" />
          </div>
        )}

        {/* Errors */}
        {error && (
          <div className="absolute top-4 right-4 bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 max-w-sm">
            <p className="text-sm font-medium">Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Received messages from backend */}
        {receivedMessages.length > 0 && (
          <div className="absolute bottom-24 left-4 bg-white shadow-md rounded-lg p-3 max-w-sm border">
            <p className="text-sm font-medium">💬 Backend Messages</p>
            <ul className="mt-2 text-sm list-disc pl-4">
              {receivedMessages.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full bg-white border-t shadow-sm py-4">
        <div className="max-w-7xl mx-auto px-6 flex justify-between text-sm text-gray-500">
          <p>© {new Date().getFullYear()} HandSpeak AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
