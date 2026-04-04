'use client';

import { useState } from 'react';
import RpsGame from '../components/RpsGame';
import ObjectMovementGame from '../components/ObjectMovementGame';
import HandPoseGame from '../components/HandPoseGame';
import SecurityGate from '../components/SecurityGate';
import ARFilter from '../components/ARFilter';

export default function Home() {
  const [activeTab, setActiveTab] = useState('가위바위보');
  const [isVipUnlocked, setIsVipUnlocked] = useState(false);

  const tabs = [
    { id: '가위바위보', label: '🎮 가위바위보', week: '2주차' },
    { id: '물건이동', label: '📦 물건 이동', week: '3주차' },
    { id: '핸드포즈', label: '✋ 핸드포즈', week: '3주차' },
    { id: '보안게이트', label: '🔐 보안 게이트', week: '4주차' },
    { id: 'AR필터', label: isVipUnlocked ? '🎭 AR 필터' : '🔒 AR 필터', week: '4주차' },
  ];

  return (
    <main>
      <header className="hero-container">
        <h1 className="main-title">🎮 AI 체험관</h1>
        <p className="subtitle">Realize Academy · 나만의 AI 체험 세계</p>
      </header>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <div className="tab-label">{tab.label}</div>
            <div className="tab-week">{tab.week}</div>
          </button>
        ))}
      </nav>

      <section className="tab-content">
        {activeTab === '가위바위보' && (
          <div className="tab-pane">
            <RpsGame />
          </div>
        )}
        {activeTab === '물건이동' && (
          <div className="tab-pane">
            <ObjectMovementGame />
          </div>
        )}
        {activeTab === '핸드포즈' && (
          <div className="tab-pane">
            <HandPoseGame />
          </div>
        )}
        {activeTab === '보안게이트' && (
          <div className="tab-pane">
            <SecurityGate onUnlock={() => setIsVipUnlocked(true)} isUnlocked={isVipUnlocked} />
          </div>
        )}
        {activeTab === 'AR필터' && (
          <div className="tab-pane">
            <ARFilter isUnlocked={isVipUnlocked} onSwitchToSecurity={() => setActiveTab('보안게이트')} />
          </div>
        )}
      </section>

      <footer className="main-footer">
        <p>Made with ❤️ by Realizer · Realize Academy</p>
      </footer>
    </main>
  );
}
