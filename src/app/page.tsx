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
  animationUrls: string[];
  onAnimationFinish?: () => void;
}

function CharacterModel({ animationUrls, onAnimationFinish }: CharacterModelProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Load the rig once (idle)
  const { scene: rigScene, animations: idleAnimations } = useGLTF(IDLE_MODEL_URL) as unknown as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  const { actions, mixer } = useAnimations(idleAnimations, rigScene);

  const [modelProps, setModelProps] = useState<{ position: [number, number, number]; scale: number }>({
    position: [0, 0, 0],
    scale: 1,
  });

  // Center and scale rig
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(rigScene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const scale = 2 / size.y;
    const position: [number, number, number] = [-center.x * scale, -center.y * scale, -center.z * scale];
    setModelProps({ position, scale });
  }, [rigScene]);

  // Play idle initially
  useEffect(() => {
    if (!actions) return;
    const idleAction = actions[Object.keys(actions)[0]];
    if (idleAction) {
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.reset().fadeIn(0.2).play();
    }
  }, [actions]);

  // Play queued animations sequentially
  useEffect(() => {
    if (!animationUrls.length || !mixer) return;

    const loader = new GLTFLoader();

    const loadAnimations = async () => {
      try {
        const clips: THREE.AnimationClip[] = [];

        for (const url of animationUrls) {
          const gltf = await new Promise<any>((resolve, reject) =>
            loader.load(url, resolve, undefined, reject)
          );

          // Remove meshes, keep only animation data
          gltf.scene.traverse((child: THREE.Mesh<THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>, THREE.Material | THREE.Material[], THREE.Object3DEventMap>) => {
            if ((child as THREE.Mesh).isMesh) gltf.scene.remove(child);
          });

          clips.push(...gltf.animations);
        }

        if (!clips.length) return;

        // Stop all current actions (idle too)
        Object.values(actions).forEach((a) => a && a.stop());

        // Play sequentially
        let index = 0;
        const playNext = () => {
          if (index >= clips.length) {
            // Return to idle
            const idleAction = actions[Object.keys(actions)[0]];
            if (idleAction) {
              idleAction.reset().fadeIn(0.2).play();
            }
            onAnimationFinish?.();
            return;
          }

          const clip = clips[index];
          const action = mixer.clipAction(clip, rigScene);
          action.reset();
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.timeScale = 2;
          action.zeroSlopeAtStart = true;
          action.fadeIn(0).play();

          const onFinished = () => {
            action.fadeOut(0.2);
            mixer.removeEventListener("finished", onFinished);
            index++;
            playNext();
          };

          mixer.addEventListener("finished", onFinished);
        };

        playNext();
      } catch (err) {
        console.error("Failed to load animation GLB:", err);
      }
    };

    loadAnimations();
  }, [animationUrls, actions, mixer, rigScene, onAnimationFinish]);

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
  const [currentAnimations, setCurrentAnimations] = useState<string[]>([]);

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

        // Preload asynchronously
        glbAnimations.forEach((glb: string | string[]) => useGLTF.preload(glb));
      } catch (err) {
        console.error("Failed to parse animation URLs:", err);
      }
    };

    setSocket(sock);
    return () => sock.close();
  }, []);

  // Queue manager
  useEffect(() => {
    if (animationQueue.length > 0 && currentAnimations.length === 0) {
      setCurrentAnimations([animationQueue[0]]);
      setAnimationQueue((prev) => prev.slice(1));
    }
  }, [animationQueue, currentAnimations]);

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

  const handleAnimationFinish = () => {
    if (animationQueue.length > 0) {
      setCurrentAnimations([animationQueue[0]]);
      setAnimationQueue((prev) => prev.slice(1));
    } else {
      setCurrentAnimations([]);
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
          <CharacterModel animationUrls={currentAnimations} onAnimationFinish={handleAnimationFinish} />
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
