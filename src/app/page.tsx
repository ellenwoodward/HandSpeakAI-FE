"use client";
import { useRef, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { Button } from "@/components/ui/button";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const BUCKET_URL = "https://storage.googleapis.com/animations-handspeak-ai/";
const IDLE_MODEL_URL = BUCKET_URL + "Generic/Idle.glb";

interface CharacterModelProps {
  animationQueue: string[];
  onQueueFinished?: () => void;
}

function CharacterModel({ animationQueue, onQueueFinished }: CharacterModelProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Load Idle rig once
  const { scene: rigScene, animations: idleAnimations } = useGLTF(IDLE_MODEL_URL) as unknown as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  const { actions, mixer } = useAnimations(idleAnimations, rigScene);

  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);

  const [modelProps, setModelProps] = useState<{ position: [number, number, number]; scale: number }>({
    position: [0, 0, 0],
    scale: 1,
  });

  // Center & scale rig
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(rigScene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const scale = 2 / size.y;
    const position: [number, number, number] = [
      -center.x * scale,
      -center.y * scale,
      -center.z * scale,
    ];
    setModelProps({ position, scale });
  }, [rigScene]);

  // Setup idle once
  useEffect(() => {
    if (!actions) return;
    const idle = actions[Object.keys(actions)[0]];
    if (idle) {
      idle.enabled = true;
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.reset().setEffectiveWeight(1).fadeIn(0.2).play();
      idleActionRef.current = idle;
      currentActionRef.current = idle;
    }
  }, [actions]);

  // Process animation queue
  useEffect(() => {
    if (!animationQueue.length || !mixer) return;

    let disposed = false;
    const loader = new GLTFLoader();

    (async () => {
      const clips: THREE.AnimationClip[] = [];
      for (const url of animationQueue) {
        const gltf = await new Promise<any>((resolve, reject) =>
          loader.load(url, resolve, undefined, reject)
        );
        if (gltf.animations?.length) {
          clips.push(...gltf.animations);
        }
      }

      if (!clips.length || disposed) return;

      let i = 0;

      const playClip = (clip: THREE.AnimationClip) => {
        if (disposed) return;

        const next = mixer.clipAction(clip, rigScene);
        next.reset();
        next.enabled = true;
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
        next.setEffectiveWeight(1);
        next.play();

        const from = currentActionRef.current;
        if (from && from !== next) {
          from.crossFadeTo(next, 0.25, false);
        }
        currentActionRef.current = next;

const onFinished = (e: any) => {
  if (e.action !== next) return;
  mixer.removeEventListener("finished", onFinished);

  // Crossfade back to idle
  if (idleActionRef.current) {
    next.crossFadeTo(idleActionRef.current, 0.25, false);
    currentActionRef.current = idleActionRef.current;
  }

  i++;
  if (i < clips.length) {
    playClip(clips[i]);
  } else {
    // ✅ Force reset idle once queue is done
    if (idleActionRef.current) {
      idleActionRef.current.reset().fadeIn(0.2).play();
      currentActionRef.current = idleActionRef.current;
    }
    onQueueFinished?.();
  }
};

        mixer.addEventListener("finished", onFinished);
      };

      playClip(clips[0]);
    })();

    return () => {
      disposed = true;
    };
  }, [animationQueue, mixer, rigScene, onQueueFinished]);

  return (
    <group ref={groupRef} position={modelProps.position} scale={modelProps.scale}>
      <primitive object={rigScene} />
    </group>
  );
}

export default function HomePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const [animationQueue, setAnimationQueue] = useState<string[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState<null | "mic" | "file">(null);
  const [error, setError] = useState<string | null>(null);

  const WEBSOCKET_URL = "wss://handspeak-backend-221849113631.europe-west1.run.app/ws";

  // WebSocket setup
  useEffect(() => {
    const sock = new WebSocket(WEBSOCKET_URL);

    sock.onopen = () => console.log("WebSocket connected");
    sock.onclose = () => console.log("WebSocket closed");
    sock.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const words = data["asl_translation"] || [];
        const glbAnimations = words.map((word: any) => BUCKET_URL + word.value + ".glb");
        setAnimationQueue((prev) => [...prev, ...glbAnimations]);

        glbAnimations.forEach((glb: string | string[]) => useGLTF.preload(glb));
      } catch (err) {
        console.error("Failed to parse animation URLs:", err);
      }
    };

    setSocket(sock);
    return () => sock.close();
  }, []);

  const sendTranscriptToWS = (text: string) => {
    if (!socket || !text) return;
    text.split(/[.?!]/)
      .filter((s) => s.trim())
      .forEach((sentence, i) => setTimeout(() => socket.send(sentence.trim()), i * 500));
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setError(null);
      setTranscript(null);
      if (!e.target.files?.[0]) return;

      setLoading("file");
      const file = e.target.files[0];
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

  const handleMicToggle = async () => {
    if (!isRecording) {
      try {
        setError(null);
        setTranscript(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          try {
            setLoading("mic");
            const blob = new Blob(chunks, { type: mimeType });
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
      <header className="w-full border-b bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">HandSpeak AI</h1>
        </div>
      </header>

      <div className="bg-white border-b shadow-sm p-4 flex gap-4 justify-center">
        <Button onClick={handleUploadClick} disabled={loading !== null || isRecording}>
          {loading === "file" ? "Uploading…" : "Upload Audio/Video"}
        </Button>
        <input type="file" accept="audio/*,video/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
        <Button variant={isRecording ? "destructive" : "secondary"} onClick={handleMicToggle} disabled={loading !== null}>
          {isRecording ? "⏹ Stop & Transcribe" : "🎤 Start Mic Recording"}
        </Button>
      </div>

      <main className="flex-1 bg-gray-100 relative">
        <Canvas shadows camera={{ position: [0, 1.5, 3], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <directionalLight castShadow position={[10, 10, 5]} intensity={10} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-near={0.5} shadow-camera-far={50} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} />
          <directionalLight position={[-5, 5, -5]} intensity={0.5} />
          <spotLight position={[0, 5, -5]} intensity={0.3} angle={Math.PI / 6} penumbra={0.5} castShadow />
          <CharacterModel animationQueue={animationQueue} onQueueFinished={() => setAnimationQueue([])} />
        </Canvas>

        {transcript && (
          <div className="absolute bottom-24 right-4 bg-white shadow-md rounded-lg p-3 max-w-sm border">
            <p className="text-sm font-medium">📝 Transcription</p>
            <p className="text-gray-800 mt-2 text-sm whitespace-pre-wrap">{transcript}</p>
          </div>
        )}

        {error && (
          <div className="absolute top-4 right-4 bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 max-w-sm">
            <p className="text-sm font-medium">Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}
      </main>

      <footer className="w-full bg-white border-t shadow-sm py-4">
        <div className="max-w-7xl mx-auto px-6 flex justify-between text-sm text-gray-500">
          <p>© {new Date().getFullYear()} HandSpeak AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

useGLTF.preload(IDLE_MODEL_URL);
