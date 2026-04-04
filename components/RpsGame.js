'use client';

import { useEffect, useRef, useState } from 'react';

const MODEL_URL = 'https://teachablemachine.withgoogle.com/models/dJ4fQpejA/';

const CLASS_COLORS = {
  '가위': '#FF6B6B',
  '주먹': '#4ECDC4',
  '보':   '#45B7D1',
};

const CLASS_EMOJI = {
  '가위': '✌️',
  '주먹': '✊',
  '보':   '🖐',
};

const JUDGE = {
  '가위': { '가위': 'draw', '주먹': 'lose', '보': 'win'  },
  '주먹': { '가위': 'win',  '주먹': 'draw', '보': 'lose' },
  '보':   { '가위': 'lose', '주먹': 'win',  '보': 'draw' },
};

const CHOICES = ['가위', '주먹', '보'];
const CONFIRM_PCT = 0.60;

export default function RpsGame() {
  const [isLoading, setIsLoading] = useState(true);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [scoreMe, setScoreMe] = useState(0);
  const [scoreCpu, setScoreCpu] = useState(0);
  const [history, setHistory] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [leftEmoji, setLeftEmoji] = useState('❓');
  const [rightEmoji, setRightEmoji] = useState('❓');
  const [resultText, setResultText] = useState('게임을 시작하세요!');
  const [countdown, setCountdown] = useState(null);
  const [isShaking, setIsShaking] = useState(false);
  const [wobbleEmoji, setWobbleEmoji] = useState(false);
  const [confetti, setConfetti] = useState([]);

  const webcamRef = useRef(null);
  const modelRef = useRef(null);
  const latestPredsRef = useRef([]);

  useEffect(() => {
    let webcam;
    let animationId;

    async function init() {
      if (typeof window.tmImage === 'undefined') {
        setTimeout(init, 500);
        return;
      }

      try {
        const model = await window.tmImage.load(MODEL_URL + 'model.json', MODEL_URL + 'metadata.json');
        modelRef.current = model;

        webcam = new window.tmImage.Webcam(400, 400, true);
        await webcam.setup();
        await webcam.play();

        const canvas = webcam.canvas;
        if (webcamRef.current) {
          webcamRef.current.innerHTML = '';
          webcamRef.current.appendChild(canvas);
          Object.assign(canvas.style, {
            width: '100%', height: 'auto',
            display: 'block', borderRadius: '20px',
          });
        }

        setIsLoading(false);

        const loop = async () => {
          webcam.update();
          const preds = await model.predict(webcam.canvas);
          latestPredsRef.current = preds;
          setPredictions(preds);
          
          animationId = requestAnimationFrame(loop);
        };
        loop();

      } catch (err) {
        console.error(err);
        setIsLoading(false);
      }
    }

    init();

    return () => {
      if (webcam) webcam.stop();
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, []);

  // Live emoji updates
  useEffect(() => {
    if (!isGameRunning && predictions.length > 0) {
      const top = predictions.reduce((a, b) => a.probability > b.probability ? a : b);
      setLeftEmoji(CLASS_EMOJI[top.className] || '❓');
    }
  }, [predictions, isGameRunning]);

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const runCountdown = async () => {
    const steps = ['3', '2', '1', '📸'];
    for (const step of steps) {
      setCountdown(step);
      await sleep(1000);
    }
    setCountdown(null);
  };

  const startGame = async () => {
    if (isGameRunning) return;
    setIsGameRunning(true);
    setResultText('준비...');
    setLeftEmoji('❓');
    setRightEmoji('❓');

    await runCountdown();

    const snapshot = latestPredsRef.current;
    const top = snapshot.reduce((a, b) => a.probability > b.probability ? a : b);

    if (top.probability < CONFIRM_PCT) {
      setResultText('⚠️ 인식 실패! 다시 시도해주세요');
      await sleep(2000);
      setResultText('게임을 시작하세요!');
      setIsGameRunning(false);
      return;
    }

    const myChoice = top.className;
    const cpuChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
    const judge = JUDGE[myChoice]?.[cpuChoice] ?? 'draw';

    setLeftEmoji(CLASS_EMOJI[myChoice]);
    setRightEmoji(CLASS_EMOJI[cpuChoice]);

    const messages = {
      win: { text: '🎉 승리!', color: '#FFD700' },
      lose: { text: '😢 패배...', color: '#FF6B6B' },
      draw: { text: '🤝 무승부', color: '#AAAAAA' },
    };
    
    setResultText(messages[judge].text);
    
    // Animations
    if (judge === 'win') spawnConfetti();
    if (judge === 'lose') {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    }
    if (judge === 'draw') {
      setWobbleEmoji(true);
      setTimeout(() => setWobbleEmoji(false), 500);
    }

    // Scores
    if (judge === 'win') setScoreMe(s => s + 1);
    if (judge === 'lose') setScoreCpu(s => s + 1);

    // History
    const badge = { win: '⭕', lose: '❌', draw: '➖' };
    setHistory(prev => [badge[judge], ...prev].slice(0, 5));

    await sleep(2500);
    setResultText('게임을 시작하세요!');
    setIsGameRunning(false);
  };

  const spawnConfetti = () => {
    const colors = ['#FFD700', '#ff4d4d', '#8b0000', '#ffffff'];
    const newConfetti = Array.from({ length: 30 }).map((_, i) => ({
      id: Date.now() + i,
      left: Math.random() * 100 + 'vw',
      color: colors[Math.floor(Math.random() * colors.length)],
      dur: (1.5 + Math.random() * 1.5) + 's',
      delay: (Math.random() * 0.5) + 's'
    }));
    setConfetti(newConfetti);
    setTimeout(() => setConfetti([]), 4000);
  };

  const topPrediction = predictions.length > 0 
    ? predictions.reduce((a, b) => a.probability > b.probability ? a : b).className 
    : '—';

  return (
    <div className={`rps-container ${isShaking ? 'shake' : ''}`}>
      {/* Countdown Overlay */}
      {countdown && (
        <div className="countdown-overlay">
          <span className="countdown-num">{countdown}</span>
        </div>
      )}

      {/* Confetti */}
      <div className="confetti-wrap">
        {confetti.map(c => (
          <div 
            key={c.id} 
            className="confetti-particle"
            style={{ 
              left: c.left, 
              background: c.color, 
              '--dur': c.dur, 
              '--delay': c.delay 
            }} 
          />
        ))}
      </div>

      <div className="game-layout">
        {/* Left: Webcam Panel */}
        <div className="rps-panel webcam-panel">
          {isLoading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>AI 모델 불러오는 중...</p>
            </div>
          )}
          <div ref={webcamRef} className="webcam-box" hidden={isLoading} />
          
          {!isLoading && (
            <div className="recognition-results">
              <h3 className="live-label">{topPrediction}</h3>
              <div className="prediction-bars">
                {predictions.map(p => (
                  <div key={p.className} className="bar-row">
                    <span className="label">{p.className}</span>
                    <div className="track">
                      <div 
                        className={`fill ${p.probability >= 0.8 ? 'glow' : ''}`}
                        style={{ 
                          width: `${Math.round(p.probability * 100)}%`,
                          background: CLASS_COLORS[p.className]
                        }}
                      />
                    </div>
                    <span className="pct">{Math.round(p.probability * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Game Controls Panel */}
        <div className="rps-panel controls-panel">
          <div className="scoreboard">
            <div className="score-item">
              <span className="name">나</span>
              <span className="count">{scoreMe}</span>
            </div>
            <div className="score-vs">VS</div>
            <div className="score-item">
              <span className="count">{scoreCpu}</span>
              <span className="name">컴퓨터</span>
            </div>
          </div>

          <div className="battle-area">
            <div className={`emoji-box ${wobbleEmoji ? 'wobble' : ''}`}>
              <div className="emoji pulse">{leftEmoji}</div>
              <span>나</span>
            </div>
            <div className="vs-lightning">⚡</div>
            <div className={`emoji-box ${wobbleEmoji ? 'wobble' : ''}`}>
              <div className="emoji pulse">{rightEmoji}</div>
              <span>컴퓨터</span>
            </div>
          </div>

          <div className="result-msg">{resultText}</div>

          <div className="action-buttons">
            <button 
              className="start-btn" 
              onClick={startGame} 
              disabled={isGameRunning || isLoading}
            >
              🎮 게임 시작
            </button>
            <button 
              className="reset-link" 
              onClick={() => { setScoreMe(0); setScoreCpu(0); setHistory([]); }}
            >
              🔄 점수 초기화
            </button>
          </div>

          <div className="history-tray">
            <p>최근 전적</p>
            <div className="badges">
              {history.length === 0 ? (
                <span className="empty">아직 기록 없음</span>
              ) : (
                history.map((h, i) => <span key={i} className="badge">{h}</span>)
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .rps-container {
          width: 100%;
          color: white;
        }
        .game-layout {
          display: grid;
          grid-template-columns: 1.5fr 1fr;
          gap: 20px;
        }
        .rps-panel {
          background: rgba(45, 5, 5, 0.4);
          backdrop-filter: blur(15px);
          border: 1px solid rgba(139, 0, 0, 0.3);
          border-radius: 30px;
          padding: 30px;
          min-height: 500px;
          display: flex;
          flex-direction: column;
        }
        .loading-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
        }
        .spinner {
          width: 50px;
          height: 50px;
          border: 5px solid rgba(139, 0, 0, 0.2);
          border-top-color: #ff4d4d;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .webcam-box {
          width: 100%;
          border-radius: 20px;
          overflow: hidden;
          margin-bottom: 20px;
          box-shadow: 0 0 30px rgba(0,0,0,0.5);
        }

        .recognition-results {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .live-label {
          font-size: 2.5rem;
          text-align: center;
          font-weight: 900;
          color: #ff4d4d;
          text-shadow: 0 0 10px rgba(139, 0, 0, 0.5);
        }
        .prediction-bars {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .bar-row {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        .bar-row .label { width: 50px; font-size: 0.9rem; opacity: 0.8; }
        .bar-row .track { flex: 1; height: 12px; background: rgba(255,255,255,0.1); border-radius: 10px; overflow: hidden; }
        .bar-row .fill { height: 100%; border-radius: 10px; transition: width 0.3s ease; }
        .fill.glow { filter: brightness(1.5); box-shadow: 0 0 10px currentColor; }
        .bar-row .pct { width: 35px; font-size: 0.8rem; opacity: 0.6; }

        .scoreboard {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0,0,0,0.2);
          padding: 20px;
          border-radius: 20px;
          margin-bottom: 30px;
        }
        .score-item { display: flex; flex-direction: column; align-items: center; }
        .score-item .name { font-size: 0.8rem; opacity: 0.5; }
        .score-item .count { font-size: 3rem; font-weight: 900; }
        .score-vs { font-size: 1.5rem; font-weight: 900; color: #8b0000; }

        .battle-area {
          display: flex;
          justify-content: space-around;
          align-items: center;
          margin-bottom: 30px;
        }
        .emoji-box { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .emoji { font-size: 5rem; }
        .emoji-box span { font-size: 0.8rem; opacity: 0.5; }
        .vs-lightning { font-size: 2rem; opacity: 0.3; }

        .result-msg {
          text-align: center;
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 30px;
          min-height: 2.25rem;
        }

        .action-buttons {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
          margin-bottom: 30px;
        }
        .start-btn {
          width: 100%;
          padding: 18px;
          border-radius: 50px;
          border: none;
          background: linear-gradient(135deg, #ff4d4d, #8b0000);
          color: white;
          font-size: 1.2rem;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 10px 20px rgba(139, 0, 0, 0.4);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .start-btn:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 15px 30px rgba(139, 0, 0, 0.6); }
        .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .reset-link { background: none; border: none; color: #666; text-decoration: underline; cursor: pointer; }

        .history-tray {
          background: rgba(0,0,0,0.1);
          padding: 15px;
          border-radius: 15px;
        }
        .history-tray p { font-size: 0.8rem; opacity: 0.4; margin-bottom: 10px; }
        .badges { display: flex; gap: 10px; }
        .badge { font-size: 1.5rem; }
        .empty { opacity: 0.3; font-size: 0.8rem; }

        /* Overlays */
        .countdown-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0,0,0,0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(5px);
        }
        .countdown-num { font-size: 10rem; font-weight: 900; animation: bounceIn 0.5s ease; }
        @keyframes bounceIn {
          0% { transform: scale(0.3); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); }
        }

        .confetti-wrap { position: fixed; inset: 0; pointer-events: none; z-index: 999; overflow: hidden; }
        .confetti-particle { position: absolute; top: -20px; width: 10px; height: 10px; border-radius: 2px; animation: fall var(--dur) linear var(--delay) forwards; }
        @keyframes fall {
          to { transform: translateY(110vh) rotate(720deg); }
        }

        .shake { animation: shakeAnim 0.5s ease; }
        @keyframes shakeAnim {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          50% { transform: translateX(10px); }
          75% { transform: translateX(-5px); }
        }

        .wobble { animation: wobbleAnim 0.5s ease; }
        @keyframes wobbleAnim {
          0%, 100% { transform: rotate(0); }
          25% { transform: rotate(-10deg); }
          75% { transform: rotate(10deg); }
        }

        @media (max-width: 768px) {
          .game-layout { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
