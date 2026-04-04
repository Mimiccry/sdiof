'use client';

import { useEffect, useRef, useState } from 'react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const MISSION_ITEMS = [
  { name: "cell phone", emoji: "📱" },
  { name: "cup", emoji: "☕" },
  { name: "mouse", emoji: "🖱️" }
];

const GAME_DURATION = 30;
const MARGIN = 50;
// TARGET_SIZE는 비디오 해상도에 대한 비율로 계산 (25%)
const TARGET_RATIO = 0.25;

export default function ObjectMovementGame() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'playing' | 'gameover'
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [debugText, setDebugText] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);

  // All game state in one ref — always fresh in the rAF loop
  const gRef = useRef({
    status: 'loading',
    mission: null,
    targetX: 0, targetY: 0, targetW: 0, targetH: 0,
    score: 0,
    cooldown: false,
    muted: false,
    vidW: 640, vidH: 480,
  });

  useEffect(() => {
    initAll();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  async function initAll() {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      detectorRef.current = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite',
          delegate: 'GPU'
        },
        scoreThreshold: 0.3,
        runningMode: 'VIDEO'
      });

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        const w = videoRef.current.videoWidth || 640;
        const h = videoRef.current.videoHeight || 480;
        gRef.current.vidW = w;
        gRef.current.vidH = h;
        videoRef.current.play();
        gRef.current.status = 'ready';
        setStatus('ready');
        runDetection();
      };
    } catch (e) {
      console.error(e);
      setDebugText('❌ 오류: ' + e.message);
      setStatus('ready');
    }
  }

  function runDetection() {
    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const detector = detectorRef.current;

      if (video && canvas && detector && video.readyState >= 2) {
        const vW = video.videoWidth;
        const vH = video.videoHeight;
        canvas.width = vW;
        canvas.height = vH;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, vW, vH);

        const g = gRef.current;

        // Draw Target Zone on canvas (same coordinate space as detections)
        if (g.status === 'playing' && g.mission) {
          ctx.strokeStyle = 'rgba(0,175,255,0.8)';
          ctx.fillStyle = 'rgba(0,175,255,0.15)';
          ctx.lineWidth = 6;
          ctx.setLineDash([20, 10]);
          ctx.strokeRect(g.targetX, g.targetY, g.targetW, g.targetH);
          ctx.fillRect(g.targetX, g.targetY, g.targetW, g.targetH);
          ctx.setLineDash([]);

          // Label
          ctx.fillStyle = 'rgba(0,175,255,0.9)';
          ctx.font = `bold ${Math.round(vW * 0.025)}px sans-serif`;
          ctx.fillText(`${g.mission.emoji} 여기로!`, g.targetX + 8, g.targetY + 30);
        }

        // Run detection
        const results = detector.detectForVideo(video, performance.now());

        let detectedInfo = '';
        results.detections.forEach(det => {
          const cat = det.categories[0];
          const name = cat.categoryName.toLowerCase().trim();

          if (['cell phone', 'cup', 'mouse'].includes(name)) {
            const { originX, originY, width, height } = det.boundingBox;
            const cx = originX + width / 2;
            const cy = originY + height / 2;

            detectedInfo = `${name} (${Math.round(cat.score * 100)}%) cx=${Math.round(cx)} cy=${Math.round(cy)}`;

            // Draw box
            ctx.strokeStyle = '#4ECDC4';
            ctx.lineWidth = 4;
            ctx.setLineDash([]);
            ctx.strokeRect(originX, originY, width, height);

            // Center dot
            ctx.fillStyle = '#FF4D4D';
            ctx.beginPath();
            ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.fill();

            // Label
            ctx.fillStyle = '#4ECDC4';
            ctx.font = `bold ${Math.round(vW * 0.022)}px sans-serif`;
            ctx.fillText(`${name} ${Math.round(cat.score * 100)}%`, originX, originY - 8);

            // Collision
            if (g.status === 'playing' && g.mission && name === g.mission.name && !g.cooldown) {
              if (cx >= g.targetX && cx <= g.targetX + g.targetW &&
                  cy >= g.targetY && cy <= g.targetY + g.targetH) {
                onSuccess();
              }
            }
          }
        });

        setDebugText(detectedInfo || '인식 대기 중...');
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function pickNewMission() {
    const g = gRef.current;
    const item = MISSION_ITEMS[Math.floor(Math.random() * MISSION_ITEMS.length)];
    const tW = Math.round(g.vidW * TARGET_RATIO);
    const tH = Math.round(g.vidH * TARGET_RATIO);
    const tx = MARGIN + Math.floor(Math.random() * (g.vidW - tW - MARGIN * 2));
    const ty = MARGIN + Math.floor(Math.random() * (g.vidH - tH - MARGIN * 2));

    g.mission = item;
    g.targetX = tx;
    g.targetY = ty;
    g.targetW = tW;
    g.targetH = tH;
  }

  function onSuccess() {
    const g = gRef.current;
    g.cooldown = true;
    g.score += 1;
    setScore(g.score);

    playSound('success');
    spawnConfetti();
    showSuccessFlash();

    setTimeout(() => {
      pickNewMission();
      g.cooldown = false;
    }, 1200);
  }

  function startGame() {
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    const g = gRef.current;
    g.score = 0;
    g.cooldown = false;
    setScore(0);
    setTimeLeft(GAME_DURATION);

    pickNewMission();
    g.status = 'playing';
    setStatus('playing');

    if (timerRef.current) clearInterval(timerRef.current);
    let t = GAME_DURATION;
    timerRef.current = setInterval(() => {
      t -= 1;
      setTimeLeft(t);
      if (t <= 0) {
        clearInterval(timerRef.current);
        gRef.current.status = 'gameover';
        playSound('gameover');
        setStatus('gameover');
      }
    }, 1000);
  }

  function playSound(type) {
    if (gRef.current.muted) return;
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const tone = (f, t, d) => {
      const o = ctx.createOscillator(); const g2 = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g2.gain.setValueAtTime(0.15, t); g2.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g2); g2.connect(ctx.destination); o.start(t); o.stop(t + d);
    };
    const now = ctx.currentTime;
    if (type === 'success') { tone(523, now, 0.1); tone(659, now + 0.1, 0.1); tone(784, now + 0.2, 0.15); }
    if (type === 'gameover') { tone(784, now, 0.2); tone(523, now + 0.25, 0.35); }
  }

  const [confettiList, setConfettiList] = useState([]);
  function spawnConfetti() {
    const colors = ['#FFD700', '#4ECDC4', '#FF6B6B', '#ffffff', '#8B0000'];
    const list = Array.from({ length: 24 }).map((_, i) => ({
      id: Date.now() + i,
      left: Math.random() * 100 + '%',
      bg: colors[i % colors.length],
      delay: (Math.random() * 0.4).toFixed(2) + 's',
      dur: (1.4 + Math.random() * 0.6).toFixed(2) + 's',
    }));
    setConfettiList(list);
    setTimeout(() => setConfettiList([]), 2200);
  }

  const [successFlash, setSuccessFlash] = useState(false);
  function showSuccessFlash() { setSuccessFlash(true); setTimeout(() => setSuccessFlash(false), 1100); }

  const [muted, setMuted] = useState(false);
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    gRef.current.muted = next;
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'white' }}>
      {/* Title Row */}
      <div style={{ width: '100%', maxWidth: 860, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: '2rem', color: '#ff4d4d', textShadow: '0 0 10px rgba(139,0,0,.5)', margin: 0 }}>📦 물건 이동 게임</h2>
        <button onClick={toggleMute} style={{ background: 'rgba(255,255,255,.1)', border: 'none', fontSize: '1.5rem', padding: '10px', borderRadius: '50%', cursor: 'pointer', color: 'white' }}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Main Card */}
      <div style={{ width: '100%', maxWidth: 860, background: 'rgba(45,5,5,.4)', backdropFilter: 'blur(15px)', border: '1px solid rgba(139,0,0,.3)', borderRadius: 30, padding: 16, position: 'relative', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,.5)' }}>

        {/* Video Viewport */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 20, overflow: 'hidden', background: '#000' }}>
          <video ref={videoRef} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)', zIndex: 2 }} />

          {/* Confetti */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none' }}>
            {confettiList.map(c => (
              <div key={c.id} style={{ position: 'absolute', top: '-10px', left: c.left, width: 10, height: 10, background: c.bg, borderRadius: 2, animationName: 'none', animation: `fallConfetti ${c.dur} ${c.delay} linear forwards` }} className="confetti-piece" />
            ))}
          </div>

          {/* HUD: Top Bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', display: 'flex', justifyContent: 'space-between', padding: '14px 20px', zIndex: 10, pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(0,0,0,.7)', padding: '8px 18px', borderRadius: 12, fontSize: '1.15rem', fontWeight: 700, border: '1px solid rgba(255,255,255,.1)' }}>
              {status === 'playing' && gRef.current.mission
                ? `${gRef.current.mission.emoji} ${gRef.current.mission.name}을 파란 영역으로!`
                : '미션 대기 중...'}
            </div>
            <div style={{ fontSize: '3.5rem', fontWeight: 900, color: '#FFD700', textShadow: '0 0 20px rgba(255,215,0,.5)', lineHeight: 1 }}>{score}</div>
          </div>

          {/* HUD: Timer Bar */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 10 }}>
            <div style={{ height: 12, background: 'rgba(255,255,255,.2)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(timeLeft / GAME_DURATION) * 100}%`, background: timeLeft <= 10 ? '#ff4d4d' : 'linear-gradient(90deg,#4ECDC4,#45B7D1)', transition: 'width 1s linear', animation: timeLeft <= 10 ? 'timerBlink .5s infinite' : 'none' }} />
            </div>
          </div>

          {/* Success Flash */}
          {successFlash && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: '6rem', fontWeight: 900, color: '#FFD700', textShadow: '0 0 40px rgba(0,0,0,.8)', animation: 'popIn .4s cubic-bezier(.175,.885,.32,1.275)' }}>🎉 성공!</div>
            </div>
          )}

          {/* Loading Overlay */}
          {status === 'loading' && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.85)' }}>
              <div className="spinner-el" />
              <p>🔄 AI 모델 로딩 중...</p>
            </div>
          )}

          {/* Start Overlay */}
          {status === 'ready' && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.7)' }}>
              <button onClick={startGame} style={{ padding: '18px 50px', fontSize: '1.6rem', fontWeight: 900, borderRadius: 50, border: 'none', background: 'linear-gradient(135deg,#ff4d4d,#8b0000)', color: 'white', cursor: 'pointer' }}>🎮 게임 시작</button>
            </div>
          )}

          {/* Game Over Overlay */}
          {status === 'gameover' && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(8px)' }}>
              <div style={{ textAlign: 'center', background: 'rgba(45,5,5,.9)', padding: '40px 60px', borderRadius: 30, border: '1px solid #8b0000' }}>
                <h2 style={{ fontSize: '2.5rem', marginBottom: 10 }}>⏰ 게임 종료!</h2>
                <p style={{ opacity: .6, marginBottom: 4 }}>최종 점수</p>
                <div style={{ fontSize: '5rem', fontWeight: 900, color: '#FFD700', marginBottom: 30 }}>{score}</div>
                <button onClick={startGame} style={{ padding: '14px 40px', fontSize: '1.4rem', fontWeight: 900, borderRadius: 50, border: 'none', background: 'linear-gradient(135deg,#ff4d4d,#8b0000)', color: 'white', cursor: 'pointer' }}>🔄 다시 하기</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Debug Bar */}
      <div style={{ marginTop: 12, padding: '8px 24px', background: 'rgba(0,0,0,.5)', borderRadius: 30, fontSize: '.85rem', color: '#aaa', fontFamily: 'monospace' }}>
        {debugText}
      </div>

      <p style={{ marginTop: 10, color: '#888', fontSize: '.9rem' }}>인식 대상: <b style={{ color: '#ccc' }}>핸드폰(cell phone) · 컵(cup) · 마우스(mouse)</b></p>

      <style>{`
        @keyframes fallConfetti {
          to { transform: translateY(600px) rotate(720deg); opacity: 0; }
        }
        @keyframes popIn {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes timerBlink { 50% { opacity: .4; } }
        @keyframes spinEl { to { transform: rotate(360deg); } }
        .spinner-el {
          width: 44px; height: 44px;
          border: 5px solid rgba(78,205,196,.2);
          border-top-color: #4ECDC4;
          border-radius: 50%;
          animation: spinEl 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
