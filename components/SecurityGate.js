'use client';

import { useEffect, useRef, useState } from 'react';

const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_PATH  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
const LEFT_EYE  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33];
const RIGHT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398,362];
const LEFT_EYEBROW  = [70,63,105,66,107,55,65,52,53,46];
const RIGHT_EYEBROW = [300,293,334,296,336,285,295,282,283,276];
const NOSE_BRIDGE   = [168,6,197,195,5];
const LIPS_OUTER    = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61];
const LIPS_INNER    = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95,78];

// 주요 포인트만 사용: 눈(33,133,362,263), 코(1,4), 입(61,291,0,17), 턱(152,377,148,234,454)
const KEY_INDICES = [33, 133, 362, 263, 1, 4, 61, 291, 0, 17, 152, 377, 148, 234, 454];

function drawPolyline(ctx, lm, indices, w, h, close = false) {
  if (!lm || indices.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(lm[indices[0]].x * w, lm[indices[0]].y * h);
  for (let i = 1; i < indices.length; i++) ctx.lineTo(lm[indices[i]].x * w, lm[indices[i]].y * h);
  if (close) ctx.closePath();
  ctx.stroke();
}

export default function SecurityGate({ onUnlock, isUnlocked }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const detectorRef = useRef(null);
  const rafRef      = useRef();

  const [isLoaded, setIsLoaded]         = useState(false);
  const [error, setError]               = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);

  // New States
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [countdownMode, setCountdownMode] = useState(null); // 'register' | 'unlock'
  const [regSuccess, setRegSuccess] = useState(false);
  const [latestLandmarks, setLatestLandmarks] = useState(null);

  const [status, setStatus] = useState('idle'); // 'idle' | 'scanning' | 'granted' | 'denied'
  const [scanResult, setScanResult] = useState(null); // { name, similarity, success }

  const initDetector = async () => {
    try {
      const vision = await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs");
      const { FaceLandmarker, FilesetResolver } = vision;
      const visionTasks = await FilesetResolver.forVisionTasks(WASM_PATH);
      detectorRef.current = await FaceLandmarker.createFromOptions(visionTasks, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      startCamera();
    } catch (err) {
      setError("Face model loading failed: " + err.message);
    }
  };

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = async () => {
        try { await videoRef.current.play(); } catch (e) { if (e.name !== 'AbortError') throw e; }
        setIsLoaded(true);
        rafRef.current = requestAnimationFrame(predictLoop);
      };
    } catch (err) {
      setError("Camera access denied");
    }
  };

  const predictLoop = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!detectorRef.current || !video || video.readyState < 2 || !video.videoWidth) {
      rafRef.current = requestAnimationFrame(predictLoop);
      return;
    }
    try {
      const result = detectorRef.current.detectForVideo(video, performance.now());
      drawLandmarks(result, canvas, video);
      const detected = result.faceLandmarks && result.faceLandmarks.length > 0;
      setFaceDetected(detected);
      if (detected) {
          setLatestLandmarks(result.faceLandmarks[0]);
      }
    } catch (e) {}
    rafRef.current = requestAnimationFrame(predictLoop);
  };

  const drawLandmarks = (result, canvas, video) => {
    if (!canvas || !video) return;
    const w = video.videoWidth, h = video.videoHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) return;
    const flipped = result.faceLandmarks[0]; // CSS의 scaleX(-1)이 이미 반전을 처리하므로 JS에서의 반전 제거

    ctx.fillStyle = 'rgba(255, 182, 193, 0.6)';
    for (const p of flipped) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 1, 0, Math.PI * 2); ctx.fill(); }

    ctx.strokeStyle = 'rgba(255, 182, 193, 0.85)';
    ctx.lineWidth = 1.2;
    drawPolyline(ctx, flipped, FACE_OVAL, w, h, true);
    drawPolyline(ctx, flipped, LEFT_EYE, w, h, true);
    drawPolyline(ctx, flipped, RIGHT_EYE, w, h, true);
    drawPolyline(ctx, flipped, LEFT_EYEBROW, w, h);
    drawPolyline(ctx, flipped, RIGHT_EYEBROW, w, h);
    drawPolyline(ctx, flipped, NOSE_BRIDGE, w, h);
    drawPolyline(ctx, flipped, LIPS_OUTER, w, h, true);
    drawPolyline(ctx, flipped, LIPS_INNER, w, h, true);
  };

  const startRegistrationFlow = () => {
      if (registeredUsers.length >= 5) {
          alert("최대 5명까지만 등록 가능합니다.");
          return;
      }
      setShowModal(true);
  };

  const handleRegister = () => {
      if (!name) return;
      setShowModal(false);
      setCountdownMode('register');
      setCountdown(3);
  };

  const handleUnlock = () => {
      if (registeredUsers.length === 0) return;
      setCountdownMode('unlock');
      setCountdown(3);
      setStatus('scanning');
      setScanResult(null);
  };

  useEffect(() => {
      if (countdown > 0) {
          const timer = setTimeout(() => setCountdown(prev => prev - 1), 1000);
          return () => clearTimeout(timer);
      }
      
      if (countdown === 0 && countdownMode) {
          if (countdownMode === 'register') {
              if (name && latestLandmarks) {
                  performCapture();
                  setCountdownMode(null);
              } else if (!latestLandmarks) {
                  // 얼굴이 없으면 잠시 대기하거나 취소
                  setCountdownMode(null);
                  setStatus('denied');
                  setTimeout(() => setStatus('idle'), 2000);
              }
          } else if (countdownMode === 'unlock') {
              if (latestLandmarks) {
                  performScan();
                  setCountdownMode(null);
              } else {
                  setCountdownMode(null);
                  setStatus('denied');
                  setTimeout(() => setStatus('idle'), 2000);
              }
          }
      }
  }, [countdown, countdownMode]); // latestLandmarks와 name을 의존성에서 제거하여 타이머 중단 방지

  const performCapture = () => {
       // 특징 벡터 추출 (코 1번 기준 정규화)
       const nose = latestLandmarks[1];
       const featureVector = KEY_INDICES.map(idx => {
           const p = latestLandmarks[idx];
           return { x: p.x - nose.x, y: p.y - nose.y, z: (p.z || 0) - (nose.z || 0) };
       });

       // 썸네일 캡처
       const tempCanvas = document.createElement('canvas');
       tempCanvas.width = 60;
       tempCanvas.height = 45;
       const tCtx = tempCanvas.getContext('2d');
       
       // 미러링된 썸네일 캡처
       tCtx.translate(60, 0);
       tCtx.scale(-1, 1);
       tCtx.drawImage(videoRef.current, 0, 0, 60, 45);
       const thumbnail = tempCanvas.toDataURL('image/jpeg', 0.8);

       const newUser = {
           id: Date.now(),
           name: name,
           thumbnail: thumbnail,
           vector: featureVector
       };

       setRegisteredUsers([...registeredUsers, newUser]);
       setName("");
       setRegSuccess(true);
       setTimeout(() => setRegSuccess(false), 1500);
  };

  const performScan = () => {
      if (!latestLandmarks || registeredUsers.length === 0) {
          setStatus('denied');
          setTimeout(() => setStatus('idle'), 3000);
          return;
      }

      const nose = latestLandmarks[1];
      const currentVector = KEY_INDICES.map(idx => {
          const p = latestLandmarks[idx];
          return { x: p.x - nose.x, y: p.y - nose.y, z: (p.z || 0) - (nose.z || 0) };
      });

      let bestMatch = null;
      let maxSimilarity = -1;

      registeredUsers.forEach(user => {
          let sumSq = 0;
          for (let i = 0; i < currentVector.length; i++) {
              const dX = currentVector[i].x - user.vector[i].x;
              const dY = currentVector[i].y - user.vector[i].y;
              const dZ = currentVector[i].z - user.vector[i].z;
              sumSq += (dX * dX) + (dY * dY) + (dZ * dZ);
          }
          const dist = Math.sqrt(sumSq);
          // 0.2 거리 정도면 상당히 다른 얼굴, 0.05 이내면 거의 같은 얼굴
          const similarity = Math.max(0, 100 - dist * 350); 
          
          if (similarity > maxSimilarity) {
              maxSimilarity = similarity;
              bestMatch = user;
          }
      });

      const success = maxSimilarity >= 70;
      setScanResult({
          name: bestMatch ? bestMatch.name : "Unknown",
          similarity: Math.round(maxSimilarity),
          success: success
      });
      setStatus(success ? 'granted' : 'denied');
      if (success && onUnlock) onUnlock();
      
      // Auto-reset status after 5 seconds
      setTimeout(() => {
          setStatus('idle');
          setScanResult(null);
      }, 5000);
  };

  const deleteUser = (id) => {
      setRegisteredUsers(registeredUsers.filter(u => u.id !== id));
  };

  useEffect(() => {
    initDetector();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="detector-panel">
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2.5rem', background: 'linear-gradient(135deg, #FFD700 0%, #FF8E53 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 900 }}>🔐 VIP 라운지 — 보안 게이트</h2>
        {isUnlocked && <div style={{ color: '#4ECDC4', fontWeight: 900, marginTop: '0.5rem' }}>✨ VIP 입장 권한 획득 완료!</div>}
      </div>

      {error && <div style={{ padding: '3rem', textAlign: 'center', color: '#ff6b6b' }}>{error}</div>}

      {!error && (
        <>
          <div className="card" style={{ 
              padding: 10, overflow: 'hidden', maxWidth: '640px', width: '100%', position: 'relative', margin: '0 auto', 
              background: 'rgba(20, 5, 5, 0.8)', 
              borderColor: status === 'scanning' ? '#00BFFF' : (status === 'granted' ? '#4ECDC4' : (status === 'denied' ? '#FF6B6B' : 'rgba(255, 215, 0, 0.3)')),
              borderWidth: '2px',
              transition: 'all 0.5s ease'
          }}>
            {!isLoaded && (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <div className="spinner-icon" style={{ margin: '0 auto 1rem', width: '40px', height: '40px', border: '4px solid rgba(255,215,0,0.1)', borderTopColor: '#FFD700', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                <p>🔄 얼굴 인식 모델 로딩 중...</p>
              </div>
            )}
            <div className="video-wrapper mirrored" style={{ display: isLoaded ? 'block' : 'none', position: 'relative', borderRadius: '12px', overflow: 'hidden' }}>
              <video ref={videoRef} playsInline muted style={{ display: 'block', width: '100%', transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }} />
              
              {/* 게이트 애니메이션 */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none', zIndex: 5 }}>
                  <div className={`gate-wing left ${status === 'granted' ? 'open' : ''}`} style={{ flex: 1, background: 'rgba(0,0,0,0.7)', borderRight: '2px solid #FFD700', transition: 'transform 1s cubic-bezier(0.4, 0, 0.2, 1)' }}></div>
                  <div className={`gate-wing right ${status === 'granted' ? 'open' : ''}`} style={{ flex: 1, background: 'rgba(0,0,0,0.7)', borderLeft: '2px solid #FFD700', transition: 'transform 1s cubic-bezier(0.4, 0, 0.2, 1)' }}></div>
              </div>

              {countdown > 0 && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 10
                }}>
                    <div style={{
                        fontSize: '10rem', color: '#FFD700', fontWeight: 900, textShadow: '0 0 30px rgba(0,0,0,0.8)',
                        animation: 'pulse 1s infinite'
                    }}>
                        {countdown}
                    </div>
                </div>
              )}

              {regSuccess && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(78, 205, 196, 0.95)', color: '#fff', padding: '1.5rem 3rem', borderRadius: '20px',
                    fontSize: '2rem', fontWeight: 900, boxShadow: '0 0 30px rgba(78, 205, 196, 0.5)', zIndex: 11
                }}>
                    ✅ 등록 완료!
                </div>
              )}

              {scanResult && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    backgroundColor: scanResult.success ? 'rgba(78, 205, 196, 0.95)' : 'rgba(255, 107, 107, 0.95)',
                    color: '#fff', padding: '2rem', borderRadius: '24px', textAlign: 'center',
                    minWidth: '300px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', zStatus: 12,
                    animation: scanResult.success ? 'popIn 0.5s forwards' : 'shake 0.5s forwards'
                }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>유사도: {scanResult.similarity}%</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900 }}>
                        {scanResult.success 
                            ? `✅ 입장 허가! \n ${scanResult.name}님 환영합니다!` 
                            : `🚫 입장 거부! \n 등록되지 않은 얼굴입니다.`}
                    </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                <div style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderRadius: '50px', 
                    background: status === 'granted' ? 'rgba(78, 205, 196, 0.1)' : (status === 'denied' ? 'rgba(255, 107, 107, 0.1)' : 'rgba(255,255,255,0.05)'),
                    border: `1px solid ${status === 'granted' ? '#4ECDC4' : (status === 'denied' ? '#FF6B6B' : 'rgba(255,255,255,0.2)')}`
                }}>
                    <span style={{ 
                        width: '10px', height: '10px', borderRadius: '50%', 
                        background: status === 'granted' ? '#4ECDC4' : (status === 'denied' ? '#FF6B6B' : (status === 'scanning' ? '#00BFFF' : '#888')),
                        animation: status === 'scanning' ? 'pulse 0.5s infinite' : 'none'
                    }}></span>
                    <span style={{ color: status === 'granted' ? '#4ECDC4' : (status === 'denied' ? '#FF6B6B' : '#fff'), fontWeight: 700 }}>
                        {status === 'idle' && "대기 중"}
                        {status === 'scanning' && "스캔 중..."}
                        {status === 'granted' && "입장 허가!"}
                        {status === 'denied' && "입장 거부!"}
                    </span>
                </div>

                {faceDetected
                  ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderRadius: '50px', background: 'rgba(78, 205, 196, 0.1)', border: '1px solid #4ECDC4' }}>
                      <span style={{ color: '#4ECDC4', fontWeight: 700 }}>✅ 얼굴 감지됨</span>
                    </div>
                  : <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderRadius: '50px', background: 'rgba(255, 107, 107, 0.1)', border: '1px solid #FF6B6B' }}>
                      <span style={{ color: '#FF6B6B', fontWeight: 700 }}>❌ 얼굴 없음</span>
                    </div>
                }
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                <button
                    className="action-btn"
                    disabled={!faceDetected || countdown > 0 || status !== 'idle'}
                    onClick={() => handleUnlock()}
                    style={{ 
                        background: 'linear-gradient(135deg, #00BFFF 0%, #1E90FF 100%)',
                        color: '#fff', border: 'none', padding: '1rem 2rem', borderRadius: '50px', fontSize: '1.1rem', fontWeight: 900,
                        cursor: 'pointer', boxShadow: '0 10px 20px rgba(0, 191, 255, 0.2)', transition: 'all 0.3s ease',
                        opacity: (!faceDetected || countdown > 0 || status !== 'idle' || registeredUsers.length === 0) ? 0.5 : 1
                    }}
                >
                    🔓 입장 시도
                </button>

                <button
                    className="action-btn"
                    disabled={!faceDetected || countdown > 0 || registeredUsers.length >= 5 || status !== 'idle'}
                    onClick={startRegistrationFlow}
                    style={{ 
                        background: 'linear-gradient(135deg, #FFD700 0%, #FF8E53 100%)',
                        color: '#000', border: 'none', padding: '1rem 2rem', borderRadius: '50px', fontSize: '1.1rem', fontWeight: 900,
                        cursor: 'pointer', boxShadow: '0 10px 20px rgba(255, 215, 0, 0.2)', transition: 'all 0.3s ease',
                        opacity: (!faceDetected || countdown > 0 || registeredUsers.length >= 5 || status !== 'idle') ? 0.5 : 1
                    }}
                >
                    📸 얼굴 등록
                </button>
            </div>
          </div>

          {registeredUsers.length > 0 && (
              <div style={{ marginTop: '3rem', maxWidth: '640px', margin: '3rem auto 0' }}>
                  <h3 style={{ marginBottom: '1.5rem', fontSize: '1.3rem', color: '#FFD700', paddingLeft: '10px', borderLeft: '4px solid #FFD700' }}>
                    📋 등록된 VIP 회원 ({registeredUsers.length}/5)
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {registeredUsers.map(user => (
                          <div key={user.id} className="card" style={{ 
                              display: 'flex', alignItems: 'center', padding: '1rem', margin: 0,
                              background: 'rgba(255, 255, 255, 0.05)', borderRadius: '15px', border: '1px solid rgba(255, 255, 255, 0.1)'
                          }}>
                              <img src={user.thumbnail} alt={user.name} style={{ width: '60px', height: '45px', borderRadius: '8px', objectFit: 'cover', border: '2px solid #FFD700' }} />
                              <div style={{ marginLeft: '1.5rem', flex: 1 }}>
                                  <div style={{ fontWeight: 900, fontSize: '1.2rem', color: '#fff' }}>{user.name}</div>
                                  <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '2px' }}>Feature ID: {user.id.toString().slice(-6)}</div>
                              </div>
                              <button 
                                onClick={() => deleteUser(user.id)} 
                                style={{ 
                                    background: 'rgba(255, 107, 107, 0.1)', border: '1px solid rgba(255, 107, 107, 0.2)', 
                                    color: '#ff6b6b', cursor: 'pointer', padding: '8px', borderRadius: '10px',
                                    transition: 'all 0.2s'
                                }}
                              >
                                🗑️ 삭제
                              </button>
                          </div>
                      ))}
                  </div>
              </div>
          )}

          {showModal && (
              <div style={{
                  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                  backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                  backdropFilter: 'blur(10px)'
              }}>
                  <div className="card" style={{ width: '350px', textAlign: 'center', padding: '2.5rem', border: '2px solid #FFD700' }}>
                      <h3 style={{ marginBottom: '1.5rem', color: '#FFD700' }}>👑 VIP 이름 등록</h3>
                      <input
                          type="text"
                          placeholder="이름을 입력하세요"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          style={{
                              width: '100%', padding: '1rem', borderRadius: '12px', border: '1px solid #444',
                              backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff', marginBottom: '2rem',
                              fontSize: '1.1rem', textAlign: 'center', outline: 'none'
                          }}
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                      />
                      <div style={{ display: 'flex', gap: '1rem' }}>
                          <button className="tab-btn" onClick={() => setShowModal(false)} style={{ flex: 1, padding: '0.8rem' }}>취소</button>
                          <button className="tab-btn active" onClick={handleRegister} style={{ flex: 1, padding: '0.8rem', background: '#FFD700', color: '#000' }}>확인</button>
                      </div>
                  </div>
              </div>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.8; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes popIn { 0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
        @keyframes shake { 
            0%, 100% { transform: translate(-50%, -50%); }
            10%, 30%, 50%, 70%, 90% { transform: translate(-55%, -50%); }
            20%, 40%, 60%, 80% { transform: translate(-45%, -50%); }
        }
        .gate-wing.left.open { transform: translateX(-100%); }
        .gate-wing.right.open { transform: translateX(100%); }
      `}</style>
    </div>
  );
}
