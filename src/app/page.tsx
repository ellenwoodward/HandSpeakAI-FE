"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, useAnimations } from "@react-three/drei";
import { Button } from "@/components/ui/button";
import SockJS from "sockjs-client";
import * as THREE from "three";

const MODEL_URL = "https://storage.googleapis.com/animations-handspeak-ai/A.glb";

function CharacterModel() {
  const { scene, animations } = useGLTF(MODEL_URL);
  const { actions } = useAnimations(animations, scene);

  // Center and scale dynamically
  const [modelProps, setModelProps] = useState({ position: [0, 0, 0], scale: 1 });

  // Center and scale
  useEffect(() => {
    if (!scene) return;
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const scale = 2 / size.y;

    // ✅ Explicit tuple with exactly 3 elements
    const position: [number, number, number] = [
      -center.x * scale,
      -center.y * scale,
      -center.z * scale,
    ];

    setModelProps({ position, scale });
  }, [scene]);

  // Play first animation
  useEffect(() => {
    if (actions) {
      const first = Object.values(actions)[0];
      first?.reset().fadeIn(0.5).play();
    }
  }, [actions]);

  return (
    <group position={modelProps.position as [number, number, number]} scale={modelProps.scale}>
      <primitive object={scene} />
    </group>
  );
}

export default function HomePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [socket, setSocket] = useState<ReturnType<typeof SockJS> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
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
        <Canvas shadows camera={{ position: [0, 1.5, 3], fov: 50 }}>
          {/* Ambient light */}
          <ambientLight intensity={0.5} />

          {/* Key directional light */}
          <directionalLight
            castShadow
            position={[10, 10, 5]}
            intensity={10}
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
            shadow-camera-near={0.5}
            shadow-camera-far={50}
            shadow-camera-left={-10}
            shadow-camera-right={10}
            shadow-camera-top={10}
            shadow-camera-bottom={-10}
          />

          {/* Fill light */}
          <directionalLight position={[-5, 5, -5]} intensity={0.5} />

          {/* Rim light */}
          <spotLight
            position={[0, 5, -5]}
            intensity={0.3}
            angle={Math.PI / 6}
            penumbra={0.5}
            castShadow
          />

          {/* Centered character */}
          <CharacterModel />
        </Canvas>

        {/* Transcript card */}
        {transcript && (
          <div className="absolute bottom-24 right-4 bg-white shadow-md rounded-lg p-3 max-w-sm border">
            <p className="text-sm font-medium">📝 Transcription</p>
            <p className="text-gray-800 mt-2 text-sm whitespace-pre-wrap">{transcript}</p>
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
