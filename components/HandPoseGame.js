'use client';

import { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ─── 기존 상수 & 함수 (유지) ─────────────────────────────────────────
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
];
const HISTORY_LEN = 3;
const GESTURE_HISTORY_LEN = 5;
const GAME_DURATION = 30;
const HOLD_DURATION = 3;
const MAX_CUSTOM = 5;
const SIMILARITY_THRESHOLD = 0.3;

const BASE_GESTURES = [
  { emoji: '👌', name: 'OK', isCustom: false },
  { emoji: '✌️', name: 'V', isCustom: false },
  { emoji: '👍', name: '엄지척', isCustom: false },
  { emoji: '✊', name: '주먹', isCustom: false },
  { emoji: '🖐', name: '보', isCustom: false },
];

function classifyGesture(stableFlags, lm) {
  const [thumb, index, middle, ring, pinky] = stableFlags;
  const dx = lm[4].x - lm[8].x, dy = lm[4].y - lm[8].y;
  if (Math.sqrt(dx*dx+dy*dy) <= 0.06 && middle && ring && pinky) return { emoji: '👌', name: 'OK' };
  if (!thumb && index && middle && !ring && !pinky) return { emoji: '✌️', name: 'V' };
  if (thumb && !index && !middle && !ring && !pinky) return { emoji: '👍', name: '엄지척' };
  if (!thumb && !index && !middle && !ring && !pinky) return { emoji: '✊', name: '주먹' };
  if (thumb && index && middle && ring && pinky) return { emoji: '🖐', name: '보' };
  return { emoji: '✨', name: '자유 제스처' };
}

function majority(hist) { return hist.filter(Boolean).length >= 2; }

function analyzeHand(lm, handedness) {
  const x5 = lm[5].x, x17 = lm[17].x;
  const isPalm = handedness === 'Right' ? x5 > x17 : x5 < x17;
  const fingers = [
    { name:'검지', tip:8, pip:6 }, { name:'중지', tip:12, pip:10 },
    { name:'약지', tip:16, pip:14 }, { name:'새끼', tip:20, pip:18 },
  ].map(f => ({ ...f, tipY: lm[f.tip].y, pipY: lm[f.pip].y, extended: lm[f.tip].y < lm[f.pip].y }));
  const tipX = lm[4].x, ipX = lm[3].x;
  let thumbExtended;
  if (handedness==='Right' && isPalm)  thumbExtended = tipX > ipX;
  else if (handedness==='Right')        thumbExtended = tipX < ipX;
  else if (handedness==='Left' && isPalm) thumbExtended = tipX < ipX;
  else                                  thumbExtended = tipX > ipX;
  return { isPalm, thumb: { name:'엄지', tip:4, pip:3, tipX, ipX, extended: thumbExtended }, fingers };
}

function majorityGesture(hist) {
  const counts = {};
  hist.forEach(g => { counts[g.name] = (counts[g.name]||0) + 1; });
  let best = hist[hist.length-1], bestCount = 0;
  Object.entries(counts).forEach(([name, cnt]) => {
    if (cnt > bestCount) { bestCount = cnt; best = hist.find(g => g.name === name); }
  });
  return { gesture: best, count: bestCount };
}

// 손목 기준 정규화 + 손 크기 정규화
function normalizeLandmarks(lm) {
  const ox = lm[0].x, oy = lm[0].y;
  const dx = lm[9].x - ox, dy = lm[9].y - oy;
  const scale = Math.sqrt(dx*dx + dy*dy) || 1;
  return lm.map(pt => ({ x: (pt.x - ox) / scale, y: (pt.y - oy) / scale }));
}

function avgDistance(lm1, lm2) {
  const n1 = normalizeLandmarks(lm1), n2 = normalizeLandmarks(lm2);
  const total = n1.reduce((sum, pt, i) => {
    const dx = pt.x - n2[i].x, dy = pt.y - n2[i].y;
    return sum + Math.sqrt(dx*dx + dy*dy);
  }, 0);
  return total / n1.length;
}
// ─────────────────────────────────────────────────────────────────────

export default function HandPoseGame() {
  const [status, setStatus] = useState('loading');
  const [handResults, setHandResults] = useState([]);
  const [gameMode, setGameMode] = useState('basic');
  const [gameStatus, setGameStatus] = useState('idle');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [mission, setMission] = useState(BASE_GESTURES[0]);
  const [holdPct, setHoldPct] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [confettiList, setConfettiList] = useState([]);

  // 나만의 제스처
  const [customGestures, setCustomGestures] = useState([]);
  const [capturePhase, setCapturePhase] = useState(null); // null|modal|countdown|flash
  const [captureCountdown, setCaptureCountdown] = useState(3);
  const [captureNameInput, setCaptureNameInput] = useState('');

  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const lmRef      = useRef(null);
  const rafRef     = useRef(null);
  const timerRef   = useRef(null);
  const cdTimerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const historyRef = useRef({});
  const gestureHistRef = useRef({});
  const latestLmRef = useRef(null); // 최신 손 랜드마크

  const gRef = useRef({
    status: 'idle', mission: BASE_GESTURES[0],
    missionIsCustom: false, missionLandmarks: null,
    holdPct: 0, score: 0, cooldown: false,
  });

  useEffect(() => {
    initAll();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (cdTimerRef.current) clearInterval(cdTimerRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  async function initAll() {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      lmRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO', numHands: 2,
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current.play();
        setStatus('ready');
        runLoop();
      };
    } catch (e) { console.error(e); setStatus('error'); }
  }

  function drawLandmarks(ctx, landmarks, vW, vH) {
    ctx.strokeStyle = '#7B61FF'; ctx.lineWidth = 2.5;
    CONNECTIONS.forEach(([a,b]) => {
      ctx.beginPath();
      ctx.moveTo(landmarks[a].x*vW, landmarks[a].y*vH);
      ctx.lineTo(landmarks[b].x*vW, landmarks[b].y*vH);
      ctx.stroke();
    });
    landmarks.forEach(pt => {
      ctx.fillStyle = '#00AFFF';
      ctx.beginPath(); ctx.arc(pt.x*vW, pt.y*vH, 5, 0, Math.PI*2); ctx.fill();
    });
  }

  function updateFingerHistory(key, rawFlags) {
    if (!historyRef.current[key]) historyRef.current[key] = rawFlags.map(() => []);
    const hist = historyRef.current[key];
    rawFlags.forEach((val, i) => { hist[i].push(val); if (hist[i].length > HISTORY_LEN) hist[i].shift(); });
    return hist.map(majority);
  }

  function runLoop() {
    const loop = () => {
      const video = videoRef.current, canvas = canvasRef.current, lm = lmRef.current;
      if (video && canvas && lm && video.readyState >= 2) {
        const vW = video.videoWidth, vH = video.videoHeight;
        canvas.width = vW; canvas.height = vH;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, vW, vH);

        const results = lm.detectForVideo(video, performance.now());
        const newResults = [];
        let detectedGestureName = null;

        if (results.landmarks?.length > 0) {
          results.landmarks.forEach((landmarks, i) => {
            const handednessObj = results.handednesses?.[i]?.[0];
            const handedness = handednessObj?.categoryName ?? 'Unknown';
            const hnScore = handednessObj?.score ?? 0;
            drawLandmarks(ctx, landmarks, vW, vH);

            const wrist = landmarks[0];
            ctx.font = `bold ${Math.round(vW*0.025)}px sans-serif`;
            ctx.fillStyle = handedness==='Left'?'#00AFFF':'#FF6B6B';
            ctx.fillText(handedness==='Left'?'왼손':'오른손', wrist.x*vW-18, wrist.y*vH-12);

            const { isPalm, thumb, fingers } = analyzeHand(landmarks, handedness);
            const rawFlags = [thumb.extended, ...fingers.map(f=>f.extended)];
            const stableFlags = updateFingerHistory(handedness, rawFlags);
            const allFingers = [
              { name:'엄지', raw:thumb, stable:stableFlags[0], isThumb:true },
              ...fingers.map((f,idx) => ({ name:f.name, raw:f, stable:stableFlags[idx+1], isThumb:false })),
            ];
            const extCount = stableFlags.filter(Boolean).length;

            const rawGesture = classifyGesture(stableFlags, landmarks);
            if (!gestureHistRef.current[handedness]) gestureHistRef.current[handedness] = [];
            const gHist = gestureHistRef.current[handedness];
            gHist.push(rawGesture);
            if (gHist.length > GESTURE_HISTORY_LEN) gHist.shift();
            const { gesture: confirmedGesture, count: gestureCount } = majorityGesture(gHist);

            if (i === 0) {
              detectedGestureName = confirmedGesture?.name;
              latestLmRef.current = landmarks;
            }

            newResults.push({ handedness, hnScore, isPalm, allFingers, extCount, landmarks, confirmedGesture, gestureCount });
          });
        }

        // 게임 로직
        const g = gRef.current;
        if (g.status === 'playing' && !g.cooldown && latestLmRef.current) {
          let matched = false;
          if (g.missionIsCustom && g.missionLandmarks) {
            const dist = avgDistance(latestLmRef.current, g.missionLandmarks);
            matched = dist < SIMILARITY_THRESHOLD;
          } else {
            matched = detectedGestureName === g.mission.name;
          }

          const INC = 1 / (HOLD_DURATION * 60);
          const DEC = 1 / (HOLD_DURATION * 60 * 2);
          g.holdPct = matched ? Math.min(1, g.holdPct + INC) : Math.max(0, g.holdPct - DEC);
          setHoldPct(g.holdPct);

          if (g.holdPct >= 1) {
            g.cooldown = true;
            g.score += 1;
            g.holdPct = 0;
            setScore(g.score);
            setHoldPct(0);
            triggerSuccess();
            setTimeout(() => {
              pickMission();
              g.cooldown = false;
            }, 1200);
          }
        }

        setHandResults(newResults);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  // ── 나만의 제스처 캡처 ──────────────────────────────────────
  function openCaptureModal() {
    if (customGestures.length >= MAX_CUSTOM) return;
    setCaptureNameInput('');
    setCapturePhase('modal');
  }

  function confirmCaptureName() {
    const name = captureNameInput.trim();
    if (!name) return;
    setCapturePhase('countdown');
    setCaptureCountdown(3);
    let cd = 3;
    cdTimerRef.current = setInterval(() => {
      cd -= 1;
      setCaptureCountdown(cd);
      if (cd <= 0) {
        clearInterval(cdTimerRef.current);
        doCapture(name);
      }
    }, 1000);
  }

  function doCapture(name) {
    setCapturePhase('flash');
    // 썸네일 캡처 (미러 포함)
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = 160; tmpCanvas.height = 120;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.translate(160, 0);
    tmpCtx.scale(-1, 1);
    tmpCtx.drawImage(videoRef.current, 0, 0, 160, 120);
    const thumbnail = tmpCanvas.toDataURL('image/jpeg', 0.7);

    const landmarks = latestLmRef.current
      ? latestLmRef.current.map(p => ({ x: p.x, y: p.y, z: p.z ?? 0 }))
      : null;

    if (landmarks) {
      const newGesture = { name, landmarks, thumbnail, emoji: '✨', isCustom: true };
      setCustomGestures(prev => [...prev, newGesture]);
    }
    setTimeout(() => setCapturePhase(null), 800);
  }

  function deleteCustomGesture(idx) {
    setCustomGestures(prev => prev.filter((_, i) => i !== idx));
  }
  // ────────────────────────────────────────────────────────────

  function getMissionPool(mode, customList) {
    if (mode === 'custom' && customList.length > 0) return [...BASE_GESTURES, ...customList];
    return BASE_GESTURES;
  }

  function pickMission(modeOverride, customOverride) {
    const mode = modeOverride ?? gameMode;
    const customs = customOverride ?? customGestures;
    const pool = getMissionPool(mode, customs);
    const m = pool[Math.floor(Math.random() * pool.length)];
    gRef.current.mission = m;
    gRef.current.missionIsCustom = m.isCustom ?? false;
    gRef.current.missionLandmarks = m.isCustom ? m.landmarks : null;
    setMission(m);
  }

  function startGame(modeOverride) {
    const mode = modeOverride ?? gameMode;
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    const g = gRef.current;
    g.status = 'playing'; g.score = 0; g.holdPct = 0; g.cooldown = false;
    setGameStatus('playing'); setScore(0); setHoldPct(0); setTimeLeft(GAME_DURATION);
    pickMission(mode, customGestures);

    if (timerRef.current) clearInterval(timerRef.current);
    let t = GAME_DURATION;
    timerRef.current = setInterval(() => {
      t -= 1; setTimeLeft(t);
      if (t <= 0) {
        clearInterval(timerRef.current);
        gRef.current.status = 'gameover';
        setGameStatus('gameover');
        playSound('gameover');
      }
    }, 1000);
  }

  function triggerSuccess() {
    setShowSuccess(true); playSound('success'); spawnConfetti();
    setTimeout(() => setShowSuccess(false), 1100);
  }

  function playSound(type) {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const tone = (f, t, d) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type='sine'; o.frequency.setValueAtTime(f,t);
      g.gain.setValueAtTime(0.15,t); g.gain.exponentialRampToValueAtTime(0.001,t+d);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t+d);
    };
    const now = ctx.currentTime;
    if (type==='success') { tone(523,now,.1); tone(659,now+.1,.1); tone(784,now+.2,.15); }
    if (type==='gameover') { tone(784,now,.2); tone(523,now+.25,.35); }
  }

  function spawnConfetti() {
    const colors = ['#FFD700','#4ECDC4','#FF6B6B','#ffffff','#7B61FF'];
    setConfettiList(Array.from({length:20}).map((_,i) => ({
      id: Date.now()+i, left: Math.random()*100+'%',
      bg: colors[i%colors.length],
      delay: (Math.random()*0.4).toFixed(2)+'s',
      dur: (1.4+Math.random()*0.6).toFixed(2)+'s',
    })));
    setTimeout(() => setConfettiList([]), 2200);
  }

  const isGlowing = holdPct > 0.7;
  const isCapturing = capturePhase === 'countdown' || capturePhase === 'flash';

  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center', color:'white' }}>
      <h2 style={{ fontSize:'2rem', color:'#ff4d4d', textShadow:'0 0 10px rgba(139,0,0,.5)', marginBottom:16 }}>
        ✋ 핸드포즈 챌린지
      </h2>

      {/* ── 이름 입력 모달 ── */}
      {capturePhase === 'modal' && (
        <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.7)', backdropFilter:'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setCapturePhase(null); }}>
          <div style={{ background:'rgba(45,5,5,.95)', border:'1px solid #8b0000', borderRadius:24, padding:'36px 40px', minWidth:320, display:'flex', flexDirection:'column', gap:16 }}>
            <h3 style={{ margin:0, fontSize:'1.4rem', textAlign:'center' }}>✋ 제스처 이름 짓기</h3>
            <input
              autoFocus
              value={captureNameInput}
              onChange={e => setCaptureNameInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && confirmCaptureName()}
              placeholder="제스처 이름을 지어주세요!"
              style={{ padding:'12px 16px', borderRadius:12, border:'1px solid rgba(255,255,255,.2)', background:'rgba(0,0,0,.4)', color:'white', fontSize:'1rem', outline:'none' }}
            />
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setCapturePhase(null)}
                style={{ flex:1, padding:'10px', borderRadius:12, border:'1px solid rgba(255,255,255,.2)', background:'transparent', color:'#aaa', cursor:'pointer' }}>취소</button>
              <button onClick={confirmCaptureName}
                style={{ flex:2, padding:'10px', borderRadius:12, border:'none', background:'linear-gradient(135deg,#ff4d4d,#8b0000)', color:'white', fontWeight:900, cursor:'pointer', fontSize:'1rem' }}>
                📸 3초 후 촬영
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 2컬럼 레이아웃 ── */}
      <div style={{ width:'100%', maxWidth:1100, display:'flex', gap:16, alignItems:'flex-start' }}>

        {/* 왼쪽 65% - 웹캠 */}
        <div style={{ flex:'0 0 65%', background:'rgba(45,5,5,.4)', backdropFilter:'blur(15px)', border:'1px solid rgba(139,0,0,.3)', borderRadius:30, padding:14, boxShadow:'0 20px 50px rgba(0,0,0,.5)' }}>
          <div style={{
            position:'relative', width:'100%', aspectRatio:'16/9', borderRadius:20, overflow:'hidden', background:'#000',
            outline: isCapturing ? `4px solid #ff4d4d` : 'none',
            animation: isCapturing ? 'captureFlash .5s infinite' : 'none',
          }}>
            <video ref={videoRef} playsInline muted
              style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', transform:'scaleX(-1)' }} />
            <canvas ref={canvasRef}
              style={{ position:'absolute', inset:0, width:'100%', height:'100%', transform:'scaleX(-1)', zIndex:2 }} />

            {/* 컨페티 */}
            <div style={{ position:'absolute', inset:0, zIndex:15, pointerEvents:'none' }}>
              {confettiList.map(c => (
                <div key={c.id} style={{ position:'absolute', top:'-10px', left:c.left, width:10, height:10, background:c.bg, borderRadius:2, animation:`fallConf ${c.dur} ${c.delay} linear forwards` }} />
              ))}
            </div>

            {/* 카운트다운 오버레이 */}
            {capturePhase === 'countdown' && (
              <div style={{ position:'absolute', inset:0, zIndex:30, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.4)', pointerEvents:'none' }}>
                <div style={{ fontSize:'8rem', fontWeight:900, color:'#ff4d4d', textShadow:'0 0 40px rgba(255,77,77,.8)', lineHeight:1 }}>{captureCountdown}</div>
                <div style={{ fontSize:'1.2rem', color:'white', marginTop:10 }}>자세를 유지해주세요!</div>
              </div>
            )}

            {/* 찰칵 플래시 */}
            {capturePhase === 'flash' && (
              <div style={{ position:'absolute', inset:0, zIndex:31, background:'rgba(255,255,255,.8)', display:'flex', alignItems:'center', justifyContent:'center', animation:'flashOut .6s forwards', pointerEvents:'none' }}>
                <div style={{ fontSize:'4rem' }}>📸 찰칵!</div>
              </div>
            )}

            {/* 로딩 */}
            {status === 'loading' && (
              <div style={{ position:'absolute', inset:0, zIndex:20, display:'flex', flexDirection:'column', gap:14, alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.85)' }}>
                <div className="hspin" /><p>🔄 AI 모델 로딩 중...</p>
              </div>
            )}

            {/* 제스처 이름 (중앙 하단) */}
            {handResults.length > 0 && (
              <div style={{ position:'absolute', bottom:50, left:0, right:0, zIndex:10, display:'flex', gap:16, justifyContent:'center', pointerEvents:'none' }}>
                {handResults.map((r,i) => (
                  <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                    <span style={{ fontSize:'4rem', lineHeight:1, filter:'drop-shadow(0 2px 8px rgba(0,0,0,.8))' }}>{r.confirmedGesture?.emoji}</span>
                    <span style={{ fontSize:'1.1rem', fontWeight:900, color:'#FFD700', background:'rgba(0,0,0,.6)', padding:'2px 12px', borderRadius:20 }}>{r.confirmedGesture?.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 성공 팝업 */}
            {showSuccess && (
              <div style={{ position:'absolute', inset:0, zIndex:30, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
                <div style={{ fontSize:'6rem', fontWeight:900, color:'#FFD700', textShadow:'0 0 40px rgba(0,0,0,.8)', animation:'popIn .4s cubic-bezier(.175,.885,.32,1.275)' }}>🎉 성공!</div>
              </div>
            )}

            {/* HUD 배지 */}
            <div style={{ position:'absolute', top:14, left:14, zIndex:5, display:'flex', gap:8 }}>
              {handResults.length === 0 ? (
                <div style={{ background:'rgba(0,0,0,.65)', padding:'6px 14px', borderRadius:10, fontSize:'.9rem' }}>손을 비춰주세요 ✋</div>
              ) : handResults.map((r,i) => (
                <div key={i} style={{ background:'rgba(0,0,0,.6)', padding:'6px 14px', borderRadius:10, fontSize:'.9rem', fontWeight:700, border:`1px solid ${r.handedness==='Left'?'#00AFFF':'#FF6B6B'}` }}>
                  {r.handedness==='Left'?'🫲':'🫱'} {r.isPalm?'손바닥':'손등'} · {r.extCount}/5
                </div>
              ))}
            </div>
          </div>

          {/* 디버그 테이블 */}
          {handResults.map((r,hi) => (
            <div key={hi} style={{ marginTop:10, overflowX:'auto', borderRadius:12, border:'1px solid rgba(255,255,255,.1)' }}>
              <table style={{ width:'100%', tableLayout:'fixed', borderCollapse:'collapse', fontSize:11, fontFamily:'monospace', background:'rgba(0,0,0,.55)', whiteSpace:'nowrap', color:'#ddd' }}>
                <colgroup><col style={{width:'9%'}}/><col style={{width:'23%'}}/><col style={{width:'23%'}}/><col style={{width:'19%'}}/><col style={{width:'26%'}}/></colgroup>
                <thead>
                  <tr style={{ background:'rgba(255,255,255,.08)', color:'#aaa' }}>
                    {['손가락','관절1 좌표','관절2 좌표','비교','결과'].map(h => <th key={h} style={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {r.allFingers.map((f,i) => {
                    const IT = f.isThumb, raw = f.raw;
                    const c1 = IT ? `TIP(4) x=${raw.tipX?.toFixed(3)}` : `TIP(${raw.tip}) y=${raw.tipY?.toFixed(3)}`;
                    const c2 = IT ? `IP(3)  x=${raw.ipX?.toFixed(3)}`  : `PIP(${raw.pip}) y=${raw.pipY?.toFixed(3)}`;
                    const cmp = IT ? `tipX ${raw.extended?'>':'<='} ipX` : `tipY ${raw.extended?'<':'>='} pipY`;
                    return (
                      <tr key={i} style={{ borderTop:'1px solid rgba(255,255,255,.07)', background:i%2===0?'rgba(255,255,255,.02)':'transparent' }}>
                        <td style={TD}>{f.name}</td><td style={TD}>{c1}</td><td style={TD}>{c2}</td><td style={TD}>{cmp}</td>
                        <td style={{ ...TD, color:f.stable?'#4ECDC4':'#FF6B6B', fontWeight:700 }}>{f.stable?'✅ 펴짐':'❌ 접힘'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.05)', color:'#aaa' }}>
                    <td colSpan={5} style={{ ...TD, textAlign:'center' }}>
                      손바닥/손등: <b style={{color:'#FFD700'}}>{r.isPalm?'손바닥':'손등'}</b>
                      &nbsp;|&nbsp;{r.handedness} ({Math.round(r.hnScore*100)}%)
                      &nbsp;|&nbsp;펴진: <b style={{color:'#4ECDC4'}}>{r.extCount}/5</b>
                      &nbsp;|&nbsp;확정: <b style={{color:'#FFD700'}}>{r.confirmedGesture?.emoji} {r.confirmedGesture?.name}</b>
                      <span style={{color:'#666'}}> ({r.gestureCount}/{GESTURE_HISTORY_LEN}프레임)</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
        </div>

        {/* 오른쪽 35% - 게임 패널 */}
        <div style={{ flex:'0 0 calc(35% - 16px)', background:'rgba(45,5,5,.4)', backdropFilter:'blur(15px)', border:'1px solid rgba(139,0,0,.3)', borderRadius:30, padding:20, boxShadow:'0 20px 50px rgba(0,0,0,.5)', display:'flex', flexDirection:'column', gap:16 }}>

          {/* 모드 탭 */}
          <div style={{ display:'flex', gap:8, background:'rgba(0,0,0,.3)', borderRadius:14, padding:4 }}>
            {[{id:'basic',label:'🎯 기본 제스처'},{id:'custom',label:'✨ 나만의 제스처'}].map(tab => (
              <button key={tab.id}
                onClick={() => { setGameMode(tab.id); if(gameStatus!=='idle') { gRef.current.status='idle'; setGameStatus('idle'); if(timerRef.current)clearInterval(timerRef.current); } }}
                style={{ flex:1, padding:'8px 4px', borderRadius:10, border:'none', cursor:'pointer', fontSize:'.8rem', fontWeight:700, transition:'all .2s', background:gameMode===tab.id?'linear-gradient(135deg,#ff4d4d,#8b0000)':'transparent', color:'white' }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── 나만의 제스처 탭 내용 ── */}
          {gameMode === 'custom' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {/* 캡처 버튼 */}
              <button onClick={openCaptureModal}
                disabled={customGestures.length >= MAX_CUSTOM || capturePhase !== null}
                style={{ padding:'10px', borderRadius:14, border:'1px dashed rgba(255,255,255,.3)', background:'rgba(255,255,255,.05)', color:'white', cursor:'pointer', fontSize:'.95rem', fontWeight:700, opacity: customGestures.length >= MAX_CUSTOM ? .4 : 1 }}>
                {customGestures.length >= MAX_CUSTOM ? `⚠️ 최대 ${MAX_CUSTOM}개 (삭제 후 추가)` : `📸 제스처 캡처 (${customGestures.length}/${MAX_CUSTOM})`}
              </button>

              {/* 저장된 제스처 목록 */}
              {customGestures.length === 0 ? (
                <div style={{ textAlign:'center', color:'#555', padding:'20px 0', fontSize:'.9rem' }}>
                  아직 저장된 제스처가 없어요<br/>📸 버튼을 눌러 만들어보세요!
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {customGestures.map((g, idx) => (
                    <div key={idx} style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(0,0,0,.3)', borderRadius:14, padding:'8px 12px', border:'1px solid rgba(255,255,255,.1)', animation:'slideIn .3s ease-out' }}>
                      {g.thumbnail && (
                        <img src={g.thumbnail} style={{ width:60, height:45, borderRadius:8, objectFit:'cover', border:'1px solid rgba(255,255,255,.15)', flexShrink:0 }} alt={g.name} />
                      )}
                      <span style={{ flex:1, fontWeight:700, fontSize:'.95rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>✨ {g.name}</span>
                      <button onClick={() => deleteCustomGesture(idx)}
                        style={{ background:'rgba(255,77,77,.15)', border:'1px solid rgba(255,77,77,.3)', borderRadius:8, color:'#FF6B6B', cursor:'pointer', padding:'4px 8px', fontSize:'.85rem', flexShrink:0 }}>
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 내 제스처로 도전 버튼 */}
              {gameStatus === 'idle' && (
                <button onClick={() => startGame('custom')}
                  disabled={customGestures.length === 0}
                  style={{ padding:'12px', borderRadius:16, border:'none', background:customGestures.length>0?'linear-gradient(135deg,#7B61FF,#4a3bbf)':'rgba(255,255,255,.1)', color:'white', fontWeight:900, cursor:customGestures.length>0?'pointer':'default', fontSize:'1rem', opacity:customGestures.length>0?1:.4 }}>
                  🎮 내 제스처로 도전!
                </button>
              )}
            </div>
          )}

          {/* ── 게임 UI (공통) ── */}
          {gameStatus === 'gameover' ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
              <div style={{ fontSize:'1rem', color:'#aaa' }}>최종 점수</div>
              <div style={{ fontSize:'5rem', fontWeight:900, color:'#FFD700', lineHeight:1 }}>{score}</div>
              <button onClick={() => startGame(gameMode)} style={BIGBTN}>🔄 다시 하기</button>
            </div>
          ) : (
            <>
              {/* 미션 */}
              <div style={{ textAlign:'center', background:'rgba(0,0,0,.3)', borderRadius:20, padding:'14px 10px' }}>
                <div style={{ fontSize:'.8rem', color:'#aaa', marginBottom:4 }}>현재 미션</div>
                <div style={{ fontSize:'3.5rem', lineHeight:1 }}>{mission.emoji ?? '✨'}</div>
                <div style={{ fontSize:'1.2rem', fontWeight:900, marginTop:6, color:'#FFD700' }}>
                  {mission.name}을(를) 해보세요!
                </div>
                {mission.isCustom && (
                  <div style={{ fontSize:'.8rem', color:'#7B61FF', marginTop:4 }}>✨ 나만의 제스처</div>
                )}
              </div>

              {/* 유지 게이지 */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.8rem', color:'#aaa', marginBottom:5 }}>
                  <span>유지 게이지</span><span>{Math.round(holdPct*100)}%</span>
                </div>
                <div style={{ height:20, background:'rgba(255,255,255,.1)', borderRadius:12, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${holdPct*100}%`, background:'linear-gradient(90deg,#8b0000,#ff4d4d)', borderRadius:12, transition:'width .1s linear', boxShadow:isGlowing?'0 0 20px rgba(255,77,77,.9)':'none' }} />
                </div>
              </div>

              {/* 점수 */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(0,0,0,.3)', borderRadius:14, padding:'10px 18px' }}>
                <span style={{ fontSize:'.9rem', color:'#aaa' }}>점수</span>
                <span style={{ fontSize:'2.5rem', fontWeight:900, color:'#FFD700' }}>{score}</span>
              </div>

              {/* 타이머 */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.8rem', color:'#aaa', marginBottom:5 }}>
                  <span>남은 시간</span>
                  <span style={{ color:timeLeft<=10?'#ff4d4d':'#aaa' }}>{timeLeft}초</span>
                </div>
                <div style={{ height:10, background:'rgba(255,255,255,.1)', borderRadius:10, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(timeLeft/GAME_DURATION)*100}%`, background:timeLeft<=10?'#ff4d4d':'linear-gradient(90deg,#4ECDC4,#45B7D1)', transition:'width 1s linear', animation:timeLeft<=10?'timerBlink .5s infinite':'none' }} />
                </div>
              </div>

              {/* 시작 버튼 (basic 탭) */}
              {gameStatus === 'idle' && gameMode === 'basic' && (
                <button onClick={() => startGame('basic')} style={BIGBTN}>🎮 게임 시작</button>
              )}

              {/* 제스처 목록 힌트 */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, justifyContent:'center' }}>
                {BASE_GESTURES.map(g => (
                  <span key={g.name} style={{ background:g.name===mission.name&&gameStatus==='playing'?'rgba(255,77,77,.3)':'rgba(255,255,255,.05)', border:g.name===mission.name&&gameStatus==='playing'?'1px solid #ff4d4d':'1px solid rgba(255,255,255,.1)', borderRadius:8, padding:'4px 8px', fontSize:'.8rem', transition:'all .3s' }}>
                    {g.emoji} {g.name}
                  </span>
                ))}
                {customGestures.map((g, i) => (
                  <span key={`c${i}`} style={{ background:g.name===mission.name&&gameStatus==='playing'?'rgba(123,97,255,.35)':'rgba(123,97,255,.08)', border:g.name===mission.name&&gameStatus==='playing'?'1px solid #7B61FF':'1px solid rgba(123,97,255,.3)', borderRadius:8, padding:'4px 8px', fontSize:'.8rem', transition:'all .3s' }}>
                    ✨ {g.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <p style={{ marginTop:14, color:'#888', fontSize:'.9rem', textAlign:'center' }}>
        양손 인식 · 21관절 추적 · 3프레임 다수결 안정화
      </p>

      <style>{`
        @keyframes fallConf { to { transform: translateY(600px) rotate(720deg); opacity: 0; } }
        @keyframes popIn { 0%{transform:scale(0);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes timerBlink { 50%{opacity:.4} }
        @keyframes hspinK { to{transform:rotate(360deg)} }
        @keyframes captureFlash { 50%{outline-color:transparent} }
        @keyframes flashOut { 0%{opacity:1} 100%{opacity:0} }
        @keyframes slideIn { from{transform:translateX(-10px);opacity:0} to{transform:translateX(0);opacity:1} }
        .hspin { width:44px;height:44px;border:5px solid rgba(0,175,255,.2);border-top-color:#00AFFF;border-radius:50%;animation:hspinK 1s linear infinite; }
      `}</style>
    </div>
  );
}

const TH = { padding:'7px 6px', textAlign:'center', fontWeight:700 };
const TD = { padding:'5px 6px', textAlign:'center' };
const BIGBTN = { width:'100%', padding:'13px', fontSize:'1.1rem', fontWeight:900, borderRadius:18, border:'none', background:'linear-gradient(135deg,#ff4d4d,#8b0000)', color:'white', cursor:'pointer' };
