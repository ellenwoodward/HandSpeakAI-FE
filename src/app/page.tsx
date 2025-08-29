"use client";

import { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Button } from "@/components/ui/button";

// ✅ Replace this with your actual GCP bucket URL
const MODEL_URL =
  "https://storage.googleapis.com/animations-handspeak-ai/character.glb";

function CharacterModel() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} scale={2} />;
}

export default function HomePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState<string | null>(null);

  // Handle video upload
  const handleUploadClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      console.log("Uploaded video:", e.target.files[0]);
    }
  };

  // Handle microphone recording
  const handleMicToggle = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const url = URL.createObjectURL(blob);
          setAudioURL(url);
          console.log("🎤 Recording stopped. Audio URL:", url);
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        setIsRecording(true);
        console.log("🎤 Recording started...");
      } catch (err) {
        console.error("Microphone access denied:", err);
      }
    } else {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      {/* Top Navigation */}
      <header className="w-full border-b bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">HandSpeak AI</h1>
          <nav className="flex items-center gap-4 text-sm font-medium text-gray-600">
            <a href="#" className="hover:text-blue-600 transition">Home</a>
            <a href="#" className="hover:text-blue-600 transition">Docs</a>
            <a href="#" className="hover:text-blue-600 transition">About</a>
          </nav>
        </div>
      </header>

      {/* Controls Bar */}
      <div className="bg-white border-b shadow-sm p-4 flex gap-4 justify-center">
        <Button onClick={handleUploadClick}>Upload Video</Button>
        <input
          type="file"
          accept="video/*"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <Button
          variant={isRecording ? "destructive" : "secondary"}
          onClick={handleMicToggle}
        >
          {isRecording ? "⏹ Stop Recording" : "🎤 Start Mic Recording"}
        </Button>
      </div>

      {/* Main 3D Workspace */}
      <main className="flex-1 bg-gray-100 relative">
        <Canvas camera={{ position: [0, 1.5, 3] }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 3, 3]} intensity={1} />
          <CharacterModel />
          <OrbitControls enableZoom={true} />
        </Canvas>

        {audioURL && (
          <div className="absolute bottom-4 right-4 bg-white shadow-md rounded-lg p-3">
            <p className="text-sm font-medium">🎧 Last Recording:</p>
            <audio controls src={audioURL} className="mt-2 w-60" />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full bg-white border-t shadow-sm py-4">
        <div className="max-w-7xl mx-auto px-6 flex justify-between text-sm text-gray-500">
          <p>© {new Date().getFullYear()} HandSpeak AI. All rights reserved.</p>
          <p>National AI Challenge 2025</p>
        </div>
      </footer>
    </div>
  );
}

// Required for loading GLTF models in React Three Fiber
useGLTF.preload(MODEL_URL);
