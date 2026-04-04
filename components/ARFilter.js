'use client';

import { useEffect, useRef, useState } from 'react';

const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_PATH  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const POSITION_MAP = {
  forehead: (lm) => ({ x: (lm[10].x + lm[151].x) / 2, y: lm[10].y }),
  eyes:     (lm) => ({ x: (lm[33].x + lm[263].x) / 2, y: (lm[33].y + lm[263].y) / 2 }),
  nose:     (lm) => ({ x: lm[4].x, y: lm[4].y }),
  mouth:    (lm) => ({ x: (lm[61].x + lm[291].x) / 2, y: (lm[13].y + lm[14].y) / 2 }),
};

const BUILT_IN_FILTERS = [
  { 
    id: 'dog', 
    name: '🐶 강아지', 
    items: [
      { emoji: '🐶', position: 'forehead' },
      { emoji: '🐽', position: 'nose' }
    ] 
  },
  { 
    id: 'sunglasses', 
    name: '😎 선글라스', 
    items: [
      { emoji: '😎', position: 'eyes' }
    ] 
  },
  { 
    id: 'crown', 
    name: '👑 왕관', 
    items: [
      { emoji: '👑', position: 'forehead' }
    ] 
  },
];

function getFaceAngle(lm, isFlipped = false) {
  const dx = isFlipped ? (lm[33].x - lm[263].x) : (lm[263].x - lm[33].x);
  const dy = isFlipped ? (lm[33].y - lm[263].y) : (lm[263].y - lm[33].y);
  return Math.atan2(dy, dx);
}

function getEyeDistance(lm, w) {
  return Math.sqrt(((lm[263].x - lm[33].x) * w) ** 2 + ((lm[263].y - lm[33].y) * w) ** 2);
}

function renderFilters(ctx, lm, w, h, activeFilter, activeCustoms, customFilters, customImages, isFlipped) {
  const flipped = isFlipped ? lm.map(p => ({ x: 1 - p.x, y: p.y })) : lm;
  const eyeDist = getEyeDistance(flipped, w);
  const angle = getFaceAngle(flipped, isFlipped);

  if (activeFilter) {
    for (const item of activeFilter.items) {
      const pos = POSITION_MAP[item.position](flipped);
      const size = item.position === 'forehead' ? eyeDist * 1.2 : eyeDist * 0.9;
      ctx.save();
      ctx.translate(pos.x * w, pos.y * h);
      ctx.rotate(angle);
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.emoji, 0, 0);
      ctx.restore();
    }
  }

  for (const cId of activeCustoms) {
    const cf = customFilters.find(f => f.id === cId);
    if (!cf) continue;
    const img = customImages[cId];
    if (!img || !img.complete) continue;
    const pos = POSITION_MAP[cf.position](flipped);
    const drawW = eyeDist * 1.5;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(pos.x * w, pos.y * h);
    ctx.rotate(angle);
    if (isFlipped) ctx.scale(-1, 1);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }
}

export default function ARFilter({ isUnlocked, onSwitchToSecurity }) {
  const videoRef         = useRef(null);
  const canvasRef        = useRef(null);
  const detectorRef      = useRef(null);
  const rafRef           = useRef();
  const customImagesRef  = useRef({});
  const latestResultRef  = useRef(null);

  const [isLoaded, setIsLoaded]           = useState(false);
  const [error, setError]                 = useState(null);
  const [activeFilter, setActiveFilter]   = useState(null);
  const [customFilters, setCustomFilters] = useState([]);
  const [activeCustoms, setActiveCustoms] = useState([]);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);

  const activeFilterRef  = useRef(activeFilter);
  const activeCustomsRef = useRef(activeCustoms);
  const customFiltersRef = useRef(customFilters);
  useEffect(() => { activeFilterRef.current = activeFilter; }, [activeFilter]);
  useEffect(() => { activeCustomsRef.current = activeCustoms; }, [activeCustoms]);
  useEffect(() => { customFiltersRef.current = customFilters; }, [customFilters]);

  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
      if (isUnlocked) {
          setShowWelcome(true);
          const timer = setTimeout(() => setShowWelcome(false), 3000);
          return () => clearTimeout(timer);
      }
  }, [isUnlocked]);

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
    const video = videoRef.current, canvas = canvasRef.current;
    if (!detectorRef.current || !video || video.readyState < 2 || !video.videoWidth) {
      rafRef.current = requestAnimationFrame(predictLoop);
      return;
    }
    try {
      const result = detectorRef.current.detectForVideo(video, performance.now());
      latestResultRef.current = result;

      if (!canvas) { rafRef.current = requestAnimationFrame(predictLoop); return; }
      const w = video.videoWidth, h = video.videoHeight;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        renderFilters(ctx, result.faceLandmarks[0], w, h,
          activeFilterRef.current, activeCustomsRef.current,
          customFiltersRef.current, customImagesRef.current, false); // Mirroring is handled by CSS scaleX(-1)
      }
    } catch (e) {}
    rafRef.current = requestAnimationFrame(predictLoop);
  };

  const handleFileUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (customFilters.length >= 3) {
          alert("최대 3개까지만 추가 가능합니다.");
          return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
          setPendingImage(event.target.result);
          setShowModal(true);
      };
      reader.readAsDataURL(file);
      e.target.value = ""; // reset input
  };

  const addCustomFilter = (position) => {
      const id = Date.now().toString();
      const img = new Image();
      img.src = pendingImage;
      img.onload = () => {
          customImagesRef.current[id] = img;
          const newFilter = { id, position, imageUrl: pendingImage };
          setCustomFilters([...customFilters, newFilter]);
          setActiveCustoms([...activeCustoms, id]);
          setShowModal(false);
          setPendingImage(null);
      };
  };

  const deleteCustomFilter = (id) => {
      setCustomFilters(customFilters.filter(f => f.id !== id));
      setActiveCustoms(activeCustoms.filter(cid => cid !== id));
      delete customImagesRef.current[id];
  };

  const toggleCustomFilter = (id) => {
      if (activeCustoms.includes(id)) {
          setActiveCustoms(activeCustoms.filter(cid => cid !== id));
      } else {
          setActiveCustoms([...activeCustoms, id]);
      }
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
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '2.5rem', background: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 900 }}>🎭 AR 필터</h2>
      </div>

      {error && <div style={{ padding: '3rem', textAlign: 'center', color: '#ff6b6b' }}>{error}</div>}

      {!error && (
        <>
          <div className="card" style={{ padding: 10, overflow: 'hidden', maxWidth: '640px', width: '100%', position: 'relative', margin: '0 auto', background: 'rgba(20, 5, 20, 0.8)', border: '1px solid rgba(255, 107, 107, 0.3)' }}>
            {!isLoaded && (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <div className="spinner-icon" style={{ margin: '0 auto 1rem', width: '40px', height: '40px', border: '4px solid rgba(255,107,107,0.1)', borderTopColor: '#FF6B6B', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                <p>🔄 얼굴 인식 모델 로딩 중...</p>
              </div>
            )}
            <div className="video-wrapper mirrored" style={{ display: isLoaded ? 'block' : 'none', position: 'relative', borderRadius: '12px', overflow: 'hidden' }}>
              <video ref={videoRef} playsInline muted style={{ display: 'block', width: '100%', transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }} />
              
              {!isUnlocked && (
                  <div style={{
                      position: 'absolute', inset: 0, 
                      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      zIndex: 50, color: '#fff', textAlign: 'center', padding: '2rem'
                  }}>
                      <div style={{ fontSize: '5rem', marginBottom: '1rem' }}>🔒</div>
                      <h3 style={{ fontSize: '1.8rem', fontWeight: 900, marginBottom: '1rem', color: '#FF6B6B' }}>VIP 전용 필터</h3>
                      <p style={{ color: '#aaa', marginBottom: '2rem', fontSize: '1.1rem' }}>보안 게이트를 먼저 통과하여<br/>VIP 권한을 획득해주세요.</p>
                      <button 
                        onClick={onSwitchToSecurity}
                        style={{ 
                            background: 'linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%)',
                            border: 'none', color: '#000', padding: '1rem 2rem', borderRadius: '50px',
                            fontWeight: 900, fontSize: '1.2rem', cursor: 'pointer', boxShadow: '0 10px 20px rgba(255, 107, 107, 0.3)'
                        }}
                      >
                        🔐 보안 게이트로 이동
                      </button>
                  </div>
              )}

              {showWelcome && (
                  <div style={{
                      position: 'absolute', inset: 0, zIndex: 100,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(78, 205, 196, 0.6)', animation: 'fadeOut 3s forwards', pointerEvents: 'none'
                  }}>
                      <h2 style={{ fontSize: '3rem', fontWeight: 900, color: '#fff', textShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
                          🎉 VIP 입장! 환영합니다!
                      </h2>
                  </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <h4 style={{ marginBottom: '1rem', color: '#aaa', fontSize: '0.9rem' }}>기본 필터 선택</h4>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                <button
                    className={`tab-btn ${activeFilter === null ? 'active' : ''}`}
                    onClick={() => setActiveFilter(null)}
                    style={{ padding: '0.6rem 1.2rem', fontSize: '0.95rem' }}
                >
                    ❌ 없음
                </button>
                {BUILT_IN_FILTERS.map(f => (
                    <button
                        key={f.id}
                        className={`tab-btn ${activeFilter?.id === f.id ? 'active' : ''}`}
                        onClick={() => setActiveFilter(f)}
                        style={{ 
                            padding: '0.6rem 1.2rem', fontSize: '0.95rem',
                            border: activeFilter?.id === f.id ? '2px solid #FF6B6B' : 'none'
                        }}
                    >
                        {f.name}
                    </button>
                ))}
            </div>

            <div style={{ marginTop: '2.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '1.2rem', color: '#FFD93D' }}>✨ 나만의 필터</h3>
                    <label style={{ 
                        background: 'rgba(255, 217, 61, 0.1)', border: '1px dashed #FFD93D', color: '#FFD93D',
                        padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer'
                    }}>
                        🖼️ 내 이미지로 필터 만들기
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
                    </label>
                </div>

                {customFilters.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        {customFilters.map(f => (
                            <div key={f.id} style={{ 
                                position: 'relative', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '15px', 
                                border: `2px solid ${activeCustoms.includes(f.id) ? '#FFD93D' : 'transparent'}`,
                                transition: 'all 0.3s'
                            }}>
                                <img 
                                    src={f.imageUrl} 
                                    onClick={() => toggleCustomFilter(f.id)}
                                    style={{ width: '80px', height: '80px', objectFit: 'contain', borderRadius: '10px', cursor: 'pointer' }} 
                                />
                                <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '4px' }}>
                                    {f.position === 'forehead' ? '이마' : f.position === 'eyes' ? '눈' : f.position === 'nose' ? '코' : '입'}
                                </div>
                                <button 
                                    onClick={() => deleteCustomFilter(f.id)}
                                    style={{ 
                                        position: 'absolute', top: '-8px', right: '-8px', width: '24px', height: '24px', 
                                        borderRadius: '50%', background: '#FF6B6B', border: 'none', color: '#fff', fontSize: '0.8rem', cursor: 'pointer'
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          </div>

          {showModal && (
              <div style={{
                  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                  backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                  backdropFilter: 'blur(10px)'
              }}>
                  <div className="card" style={{ width: '350px', textAlign: 'center', padding: '2rem', border: '2px solid #FFD93D' }}>
                      <h3 style={{ marginBottom: '1rem', color: '#FFD93D' }}>📍 필터 위치 선택</h3>
                      <p style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '1.5rem' }}>이미지가 나타날 위치를 선택해주세요.</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                          <button className="tab-btn" onClick={() => addCustomFilter('forehead')}>이마 위에</button>
                          <button className="tab-btn" onClick={() => addCustomFilter('eyes')}>눈 중간에</button>
                          <button className="tab-btn" onClick={() => addCustomFilter('nose')}>코 위에</button>
                          <button className="tab-btn" onClick={() => addCustomFilter('mouth')}>입 위에</button>
                      </div>
                      <button 
                        onClick={() => { setShowModal(false); setPendingImage(null); }}
                        style={{ marginTop: '1.5rem', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        취소하기
                      </button>
                  </div>
              </div>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeOut { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}
