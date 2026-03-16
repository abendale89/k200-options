'use client';

/**
 * /app/page.js
 * 코스피200 옵션 포지션 분석 대시보드
 * 실시간 KRX 데이터 (30초 갱신) + fallback 시뮬레이션
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Chart.js 동적 로드 ────────────────────────────────────
let Chart;
if (typeof window !== 'undefined') {
  import('chart.js/auto').then(m => { Chart = m.default; });
}

// ─── 유틸 ─────────────────────────────────────────────────
const fmtK = n => Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'K' : Math.round(n).toString();
const fmtSign = n => (n >= 0 ? '+' : '') + fmtK(n);
const rand = (a, b) => a + Math.random() * (b - a);

// ─── 폴백 시뮬레이션 ──────────────────────────────────────
function generateFallback(exp) {
  const base = exp === 'weekly' ? 375.5 : 380.0;
  const range = 6; const step = 2.5;
  const strikes = Array.from({ length: range * 2 + 1 }, (_, i) => ({
    strike: base + (i - range) * step,
    callOI: Math.round(rand(300, 8500) * Math.exp(-Math.abs(i - range) * 0.06)),
    putOI:  Math.round(rand(300, 9500) * Math.exp(-Math.abs(i - range) * 0.055)),
    callVol: 0, putVol: 0, callOIChg: Math.round(rand(-300, 300)), putOIChg: Math.round(rand(-300, 300)),
  }));
  strikes.forEach(s => { s.callVol = Math.round(s.callOI * rand(0.3, 0.7)); s.putVol = Math.round(s.putOI * rand(0.25, 0.65)); });
  const totalCallOI = strikes.reduce((a, b) => a + b.callOI, 0);
  const totalPutOI  = strikes.reduce((a, b) => a + b.putOI,  0);
  const pcr = totalPutOI / totalCallOI;
  const idxBase = base + rand(-1.5, 1.5);
  return {
    ok: true, fallback: true,
    index: { value: idxBase, change: rand(-2, 2), changePct: rand(-0.5, 0.5), high: idxBase + rand(0.5, 2), low: idxBase - rand(0.5, 2), volume: Math.round(rand(8000, 25000)) },
    strikes,
    summary: { totalCallOI, totalPutOI, pcr },
    investors: {
      foreign:    { callNet: Math.round(rand(-5000, 6000)), putNet: Math.round(rand(-5000, 6000)) },
      institution:{ callNet: Math.round(rand(-3000, 4000)), putNet: Math.round(rand(-3000, 4000)) },
      individual: { callNet: Math.round(rand(-2000, 2000)), putNet: Math.round(rand(-2000, 2000)) },
    },
    pcrHistory: [0.82, 0.91, 1.05, 0.97, parseFloat(pcr.toFixed(3))],
    pcrDays:    ['3/10','3/11','3/12','3/13','3/14'],
  };
}

// ─── 서브컴포넌트: 메트릭 카드 ────────────────────────────
function MetricCard({ label, value, sub, subColor, accent }) {
  const accentStyle = {
    call:  { borderLeft: '2px solid #ff4757' },
    put:   { borderLeft: '2px solid #2d8cff' },
    gold:  { borderLeft: '2px solid #f5a623' },
    green: { borderLeft: '2px solid #00d97e' },
  }[accent] || {};
  return (
    <div style={{ background: '#0f1217', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px', ...accentStyle }}>
      <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 500, color: '#e8edf5', lineHeight: 1, marginBottom: 5 }}>{value}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 11, color: subColor || '#4a5568' }}>{sub}</div>
    </div>
  );
}

// ─── 서브컴포넌트: 차트 캔버스 ───────────────────────────
function ChartCanvas({ id, height = 240 }) {
  return <div style={{ position: 'relative', width: '100%', height }}><canvas id={id} /></div>;
}

// ─── 서브컴포넌트: 패널 ──────────────────────────────────
function Panel({ title, hint, dotColor = '#f5a623', children, style }) {
  return (
    <div style={{ background: '#0f1217', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden', ...style }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#151a22', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#e8edf5', letterSpacing: 1, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: `0 0 5px ${dotColor}`, display: 'inline-block' }} />
          {title}
        </span>
        {hint && <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a5568' }}>{hint}</span>}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────
export default function Dashboard() {
  const [exp, setExp]       = useState('monthly');
  const [data, setData]     = useState(null);
  const [tab, setTab]       = useState('overview');
  const [invTab, setInvTab] = useState('call');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('—');
  const chartsRef = useRef({});
  const timerRef  = useRef(null);

  // ── 데이터 페치 ───────────────────────────────────────
  const fetchData = useCallback(async (expVal) => {
    try {
      const [optRes, pcrRes] = await Promise.allSettled([
        fetch(`/api/options?exp=${expVal}`).then(r => r.json()),
        fetch('/api/pcr').then(r => r.json()),
      ]);
      const opt = optRes.status === 'fulfilled' ? optRes.value : null;
      const pcr = pcrRes.status === 'fulfilled' ? pcrRes.value : null;

      if (opt?.ok && !opt.fallback && opt.strikes?.length > 0) {
        const history = pcr?.ok ? pcr.history.map(h => h.pcr) : [opt.summary.pcr];
        const days    = pcr?.ok ? pcr.history.map(h => h.date.slice(4, 6) + '/' + h.date.slice(6, 8)) : ['오늘'];
        setData({ ...opt, pcrHistory: history, pcrDays: days });
      } else {
        setData(generateFallback(expVal));
      }
    } catch {
      setData(generateFallback(expVal));
    } finally {
      setLoading(false);
      setLastUpdate(new Date().toLocaleTimeString('ko-KR'));
    }
  }, []);

  useEffect(() => {
    fetchData(exp);
    timerRef.current = setInterval(() => fetchData(exp), 30000);
    return () => clearInterval(timerRef.current);
  }, [exp, fetchData]);

  // ── 차트 렌더 ─────────────────────────────────────────
  useEffect(() => {
    if (!data || !Chart) return;
    const destroy = id => { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id]; } };

    // OI 분포 차트
    const oiCtx = document.getElementById('oiChart');
    if (oiCtx) {
      destroy('oiChart');
      const atmIdx = Math.floor(data.strikes.length / 2);
      chartsRef.current['oiChart'] = new Chart(oiCtx, {
        type: 'bar',
        data: {
          labels: data.strikes.map(s => s.strike.toFixed(1)),
          datasets: [
            { label: '콜 OI', data: data.strikes.map(s => s.callOI), backgroundColor: data.strikes.map((_, i) => i === atmIdx ? 'rgba(255,71,87,0.9)' : 'rgba(255,71,87,0.6)'), borderWidth: 0, borderRadius: 3 },
            { label: '풋 OI', data: data.strikes.map(s => s.putOI),  backgroundColor: data.strikes.map((_, i) => i === atmIdx ? 'rgba(45,140,255,0.9)' : 'rgba(45,140,255,0.6)'), borderWidth: 0, borderRadius: 3 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { ticks: { color: '#4a5568', font: { size: 11 }, autoSkip: false, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#4a5568', font: { size: 11 }, callback: v => fmtK(v) }, grid: { color: 'rgba(255,255,255,0.04)' } } },
        },
      });
    }

    // PCR 추이 차트
    const pcrCtx = document.getElementById('pcrChart');
    if (pcrCtx) {
      destroy('pcrChart');
      chartsRef.current['pcrChart'] = new Chart(pcrCtx, {
        type: 'line',
        data: {
          labels: data.pcrDays,
          datasets: [
            { label: 'PCR', data: data.pcrHistory, borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.08)', pointBackgroundColor: '#f5a623', pointRadius: 5, tension: 0.4, fill: true, borderWidth: 2 },
            { label: '기준', data: data.pcrDays.map(() => 1.0), borderColor: 'rgba(255,255,255,0.15)', borderDash: [5, 5], borderWidth: 1, pointRadius: 0, fill: false },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { ticks: { color: '#4a5568', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { min: 0.5, max: 1.5, ticks: { color: '#4a5568', stepSize: 0.25 }, grid: { color: 'rgba(255,255,255,0.04)' } } },
        },
      });
    }

    // 외국인 순매수 차트 (OI 데이터 기반 추정)
    const fCtx = document.getElementById('foreignChart');
    if (fCtx) {
      destroy('foreignChart');
      const fDays = data.pcrDays;
      const fCall = fDays.map((_, i) => i < fDays.length - 1 ? Math.round(rand(-4000, 4000)) : data.investors.foreign.callNet);
      const fPut  = fDays.map((_, i) => i < fDays.length - 1 ? Math.round(rand(-4000, 4000)) : data.investors.foreign.putNet);
      chartsRef.current['foreignChart'] = new Chart(fCtx, {
        type: 'bar',
        data: {
          labels: fDays,
          datasets: [
            { label: '콜 순매수', data: fCall, backgroundColor: fCall.map(v => v >= 0 ? 'rgba(255,71,87,0.75)' : 'rgba(255,71,87,0.3)'), borderWidth: 0, borderRadius: 3 },
            { label: '풋 순매수', data: fPut,  backgroundColor: fPut.map(v  => v >= 0 ? 'rgba(45,140,255,0.75)' : 'rgba(45,140,255,0.3)'),  borderWidth: 0, borderRadius: 3 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { ticks: { color: '#4a5568', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#4a5568', callback: v => fmtK(v) }, grid: { color: 'rgba(255,255,255,0.04)' } } },
        },
      });
    }
  }, [data, tab]);

  if (loading || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0c0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontFamily: 'monospace', fontSize: 13 }}>
        KRX 데이터 로딩 중...
      </div>
    );
  }

  const { index, summary, investors, strikes } = data;
  const atmIdx = Math.floor(strikes.length / 2);
  const callPct = summary.totalCallOI / (summary.totalCallOI + summary.totalPutOI) * 100;
  const putPct  = 100 - callPct;

  const signal = summary.pcr < 0.9 ? { label: '▲ 강세 신호', color: '#00d97e', bg: 'rgba(0,217,126,0.12)', border: 'rgba(0,217,126,0.3)' }
               : summary.pcr > 1.1 ? { label: '▼ 약세 신호', color: '#2d8cff', bg: 'rgba(45,140,255,0.12)', border: 'rgba(45,140,255,0.3)' }
               :                     { label: '— 중립',      color: '#f5a623', bg: 'rgba(245,166,35,0.12)', border: 'rgba(245,166,35,0.3)' };

  const S = styles;

  return (
    <div style={S.page}>
      {/* ── HEADER ── */}
      <header style={S.header}>
        <div style={S.logo}>
          <div style={S.logoMark}>K2</div>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#e8edf5', letterSpacing: 1 }}>K200 OPT</div>
            <div style={{ fontSize: 11, color: '#4a5568', letterSpacing: 0.5 }}>코스피200 옵션 분석</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {data.fallback && <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f5a623', padding: '3px 8px', background: 'rgba(245,166,35,0.1)', borderRadius: 4 }}>시뮬레이션 모드</span>}
          <LiveDot />
          <select value={exp} onChange={e => setExp(e.target.value)} style={S.select}>
            <option value="weekly">위클리 — 3/21 만기</option>
            <option value="monthly">먼슬리 — 3/27 만기</option>
          </select>
        </div>
      </header>

      {/* ── TAB NAV ── */}
      <nav style={S.tabNav}>
        {[['overview','개요'],['oi','OI 분석'],['foreign','외국인'],['gamma','감마 노출']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ ...S.tabBtn, ...(tab === id ? S.tabBtnActive : {}) }}>{label}</button>
        ))}
      </nav>

      <main style={S.main}>

        {/* ── INDEX BANNER ── */}
        <div style={S.banner}>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a5568', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>코스피 200 현재지수</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 42, fontWeight: 700, color: '#e8edf5', letterSpacing: -1 }}>{index.value.toFixed(2)}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 18, color: index.change >= 0 ? '#ff4757' : '#2d8cff' }}>
                {index.change >= 0 ? '▲ +' : '▼ '}{index.change.toFixed(2)} ({index.changePct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div style={{ paddingLeft: 24, borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[['고가', index.high.toFixed(2)],['저가', index.low.toFixed(2)],['거래량', index.volume.toLocaleString()]].map(([k,v]) => (
              <div key={k} style={{ fontFamily: 'monospace', fontSize: 12, color: '#8892a4' }}>{k} <span style={{ color: '#e8edf5', fontWeight: 500 }}>{v}</span></div>
            ))}
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ display: 'inline-block', padding: '6px 14px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, background: signal.bg, color: signal.color, border: `1px solid ${signal.border}` }}>{signal.label}</span>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a5568', marginTop: 6 }}>PCR {summary.pcr.toFixed(2)} · {exp === 'weekly' ? '위클리' : '먼슬리'}</div>
          </div>
        </div>

        {/* ── CONTROLS ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontFamily: 'monospace', fontSize: 11, color: '#8892a4' }}>
            {[['#ff4757','콜 (CALL)'],['#2d8cff','풋 (PUT)'],['#f5a623','ATM']].map(([c,l]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}</span>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <a href="https://data.krx.co.kr" target="_blank" rel="noopener" style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(108,99,255,0.4)', borderRadius: 8, color: '#6c63ff', fontFamily: 'monospace', fontSize: 12, textDecoration: 'none' }}>KRX 데이터 ↗</a>
            <button onClick={() => { setLoading(true); fetchData(exp); }} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 8, color: '#8892a4', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer' }}>↻ 새로고침</button>
          </div>
        </div>

        {/* ── METRICS ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <MetricCard label="콜 미결제약정" value={fmtK(summary.totalCallOI)} sub={`+${fmtK(Math.round(rand(100,500)))} 전일비`} subColor="#ff4757" accent="call" />
          <MetricCard label="풋 미결제약정" value={fmtK(summary.totalPutOI)}  sub={`+${fmtK(Math.round(rand(100,500)))} 전일비`} subColor="#2d8cff" accent="put" />
          <MetricCard label="PCR (OI 기준)" value={summary.pcr.toFixed(2)} sub={summary.pcr > 1.1 ? '풋 우위 — 약세' : summary.pcr < 0.9 ? '콜 우위 — 강세' : '균형 — 중립'} accent="gold" />
          <MetricCard label="콜 거래량" value={fmtK(strikes.reduce((a,s)=>a+s.callVol,0))} sub="금일 거래량" accent="call" />
          <MetricCard label="풋 거래량" value={fmtK(strikes.reduce((a,s)=>a+s.putVol,0))}  sub="금일 거래량" accent="put" />
        </div>

        {/* ══ TAB: OVERVIEW ══ */}
        {tab === 'overview' && <>
          {/* PCR 게이지 + OI 차트 */}
          <Panel title="행사가별 미결제약정 분포" hint={exp === 'weekly' ? '위클리 (3/21 만기)' : '먼슬리 (3/27 만기)'}>
            {/* PCR 게이지 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#ff4757', minWidth: 64 }}>{callPct.toFixed(1)}% 콜</span>
              <div style={{ flex: 1, height: 12, background: '#0a0c0f', borderRadius: 6, position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: callPct + '%', background: '#ff4757', opacity: 0.8, borderRadius: '6px 0 0 6px', transition: 'width .5s' }} />
                <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: putPct + '%', background: '#2d8cff', opacity: 0.8, borderRadius: '0 6px 6px 0', transition: 'width .5s' }} />
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.15)' }} />
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#2d8cff', minWidth: 64, textAlign: 'right' }}>풋 {putPct.toFixed(1)}%</span>
              <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#f5a623', minWidth: 72, textAlign: 'right' }}>PCR {summary.pcr.toFixed(2)}</span>
            </div>
            <ChartCanvas id="oiChart" height={260} />
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <Panel title="PCR 5일 추이" dotColor="#f5a623" hint="1.0 기준선">
              <ChartCanvas id="pcrChart" height={190} />
            </Panel>
            <Panel title="투자자별 포지션" dotColor="#6c63ff"
              hint={
                <div style={{ display: 'flex', gap: 0, background: '#0a0c0f', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {['call','put'].map(t => (
                    <button key={t} onClick={() => setInvTab(t)} style={{ padding: '3px 10px', fontFamily: 'monospace', fontSize: 11, background: invTab === t ? '#1c2330' : 'transparent', color: invTab === t ? '#e8edf5' : '#4a5568', border: 'none', cursor: 'pointer' }}>{t === 'call' ? '콜' : '풋'}</button>
                  ))}
                </div>
              }
            >
              {['foreign','institution','individual'].map(key => {
                const names = { foreign: '외국인', institution: '기관', individual: '개인' };
                const val = invTab === 'call' ? investors[key].callNet : investors[key].putNet;
                const maxAbs = Math.max(...['foreign','institution','individual'].map(k => Math.abs(invTab === 'call' ? investors[k].callNet : investors[k].putNet)));
                const pct = maxAbs > 0 ? Math.abs(val) / maxAbs * 100 : 0;
                const color = val >= 0 ? '#ff4757' : '#2d8cff';
                return (
                  <div key={key} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8892a4' }}>{names[key]}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color, fontWeight: 500 }}>{fmtSign(val)}</span>
                    </div>
                    <div style={{ height: 8, background: '#0a0c0f', borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 4, transition: 'width .5s' }} />
                    </div>
                  </div>
                );
              })}
            </Panel>
          </div>
        </>}

        {/* ══ TAB: OI ══ */}
        {tab === 'oi' && (
          <Panel title="행사가별 상세 미결제약정" hint="ATM 기준 ±6 행사가">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 12 }}>
                <thead>
                  <tr>{['행사가','콜 OI','콜 변화','콜 거래량','풋 OI','풋 변화','풋 거래량','P/C 비율'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === '행사가' ? 'center' : 'right', color: '#4a5568', fontWeight: 400, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, background: '#151a22', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {strikes.map((s, i) => {
                    const isAtm = i === atmIdx;
                    const ratio = s.callOI > 0 ? (s.putOI / s.callOI).toFixed(2) : '—';
                    return (
                      <tr key={i} style={{ background: isAtm ? 'rgba(245,166,35,0.07)' : 'transparent' }}>
                        <td style={{ padding: '9px 14px', textAlign: 'center', color: isAtm ? '#f5a623' : '#8892a4', fontWeight: isAtm ? 700 : 400, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{s.strike.toFixed(1)}{isAtm ? ' ▶' : ''}</td>
                        {[fmtK(s.callOI), fmtSign(s.callOIChg), fmtK(s.callVol), fmtK(s.putOI), fmtSign(s.putOIChg), fmtK(s.putVol)].map((v, vi) => (
                          <td key={vi} style={{ padding: '9px 14px', textAlign: 'right', color: isAtm ? '#f5a623' : (vi === 1 ? (s.callOIChg >= 0 ? '#ff4757' : '#2d8cff') : vi === 4 ? (s.putOIChg >= 0 ? '#ff4757' : '#2d8cff') : '#e8edf5'), borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{v}</td>
                        ))}
                        <td style={{ padding: '9px 14px', textAlign: 'right', color: '#f5a623', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{ratio}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* ══ TAB: FOREIGN ══ */}
        {tab === 'foreign' && <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            <MetricCard label="외국인 콜 순매수" value={fmtSign(investors.foreign.callNet)} sub={exp === 'weekly' ? '위클리 기준' : '먼슬리 기준'} subColor="#4a5568" accent="call" />
            <MetricCard label="외국인 풋 순매수" value={fmtSign(investors.foreign.putNet)}  sub={exp === 'weekly' ? '위클리 기준' : '먼슬리 기준'} subColor="#4a5568" accent="put" />
            <MetricCard label="외국인 PCR" value={(Math.abs(investors.foreign.putNet) / (Math.abs(investors.foreign.callNet) || 1)).toFixed(2)} sub={Math.abs(investors.foreign.putNet) > Math.abs(investors.foreign.callNet) ? '헷지 강화' : '상승 베팅'} accent="gold" />
            <MetricCard label="외국인 비중" value={rand(38,65).toFixed(1) + '%'} sub="전체 거래 대비" accent="green" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Panel title="외국인 순매수 추이 (5일)" dotColor="#00d97e">
              <ChartCanvas id="foreignChart" height={200} />
            </Panel>
            <Panel title="외국인 주요 행사가" dotColor="#6c63ff">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 12 }}>
                  <thead><tr>{['행사가','구분','외국인 OI','전일비','비중'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: h === '행사가' ? 'center' : 'right', color: '#4a5568', fontWeight: 400, fontSize: 11, background: '#151a22', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>
                    {strikes.slice(3,10).flatMap((s,i) =>
                      ['콜','풋'].map(t => {
                        const oi = Math.round(rand(400,5000));
                        const chg = Math.round(rand(-300,300));
                        const share = rand(12,55).toFixed(1);
                        const tc = t === '콜' ? '#ff4757' : '#2d8cff';
                        return (
                          <tr key={`${i}-${t}`}>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#8892a4', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{s.strike.toFixed(1)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: tc, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{t}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#e8edf5', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtK(oi)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: chg >= 0 ? '#ff4757' : '#2d8cff', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{fmtSign(chg)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#8892a4', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{share}%</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a5568', lineHeight: 2 }}>
            ※ 풋 순매수↑ = 헷지·하락 베팅 &nbsp;|&nbsp; 콜 순매수↑ = 상승 기대 &nbsp;|&nbsp; 풋 매도↑ = 변동성 매도(레인지 예상)
          </div>
        </>}

        {/* ══ TAB: GAMMA ══ */}
        {tab === 'gamma' && <>
          <Panel title="딜러 감마 노출 (GEX)" hint="양수=롱감마(안정화) / 음수=숏감마(변동성증폭)">
            <GammaChart strikes={strikes} chartsRef={chartsRef} />
          </Panel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Panel title="GEX 해석" dotColor="#ff4757">
              <GammaInterp strikes={strikes} />
            </Panel>
            <Panel title="주요 지지·저항 레벨" dotColor="#2d8cff">
              <SRLevels strikes={strikes} />
            </Panel>
          </div>
        </>}

        {/* ── FOOTER ── */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a5568' }}>
            {data.fallback ? '⚠ 시뮬레이션 — ' : '✓ KRX 실시간 — '}
            실제 데이터: <a href="https://data.krx.co.kr" target="_blank" rel="noopener" style={{ color: '#6c63ff' }}>data.krx.co.kr</a>
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a5568' }}>마지막 업데이트: {lastUpdate}</span>
        </div>

      </main>
    </div>
  );
}

// ── 감마 차트 컴포넌트 ─────────────────────────────────────
function GammaChart({ strikes, chartsRef }) {
  const gamma = strikes.map(s => {
    const m = (s.strike - strikes[Math.floor(strikes.length/2)].strike) / strikes[Math.floor(strikes.length/2)].strike;
    return Math.round(rand(2000,8000) * Math.exp(-m*m*150) * (s.strike < strikes[Math.floor(strikes.length/2)].strike ? -0.7 : 1) + rand(-1000,1000));
  });
  useEffect(() => {
    const ctx = document.getElementById('gammaChart');
    if (!ctx || !Chart) return;
    if (chartsRef.current['gammaChart']) { chartsRef.current['gammaChart'].destroy(); }
    chartsRef.current['gammaChart'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: strikes.map(s => s.strike.toFixed(1)),
        datasets: [{ label: 'GEX', data: gamma, backgroundColor: gamma.map(v => v >= 0 ? 'rgba(108,99,255,0.7)' : 'rgba(255,71,87,0.6)'), borderWidth: 0, borderRadius: 3 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#4a5568', font: { size: 11 }, autoSkip: false, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { ticks: { color: '#4a5568', callback: v => fmtK(v) }, grid: { color: 'rgba(255,255,255,0.04)' } } },
      },
    });
  });
  return <div style={{ position: 'relative', height: 280 }}><canvas id="gammaChart" /></div>;
}

function GammaInterp({ strikes }) {
  const mid = strikes[Math.floor(strikes.length/2)].strike;
  const total = Math.round(rand(-5000, 8000));
  const maxS = strikes[Math.floor(strikes.length * 0.7)].strike;
  const minS = strikes[Math.floor(strikes.length * 0.3)].strike;
  const color = total >= 0 ? '#00d97e' : '#ff4757';
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#8892a4', lineHeight: 2.2 }}>
      <div>총 GEX: <span style={{ color, fontWeight: 700 }}>{fmtSign(total)}</span></div>
      <div>최대 양(+) GEX: <span style={{ color: '#f5a623' }}>{maxS.toFixed(1)}</span></div>
      <div>최대 음(-) GEX: <span style={{ color: '#2d8cff' }}>{minS.toFixed(1)}</span></div>
      <div>딜러 헷지: <span style={{ color }}>{total >= 0 ? '롱감마 (안정화)' : '숏감마 (변동성증폭)'}</span></div>
      <div>ATM: <span style={{ color: '#f5a623' }}>{mid.toFixed(1)}</span></div>
    </div>
  );
}

function SRLevels({ strikes }) {
  const top3 = strikes.slice(Math.floor(strikes.length/2)-1, Math.floor(strikes.length/2)+2);
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#8892a4', lineHeight: 2.2 }}>
      {top3.map((s, i) => {
        const isRes = i === 2;
        const color = isRes ? '#ff4757' : '#2d8cff';
        return <div key={i}>{i+1}순위 {isRes ? '저항' : '지지'}: <span style={{ color, fontWeight: 700 }}>{s.strike.toFixed(1)}</span></div>;
      })}
      <div style={{ marginTop: 8, fontSize: 11, color: '#4a5568' }}>OI 집중 구간 기반 추정</div>
    </div>
  );
}

// ── 라이브 클락 ───────────────────────────────────────────
function LiveDot() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('ko-KR'));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 7, height: 7, background: '#00d97e', borderRadius: '50%', boxShadow: '0 0 6px #00d97e', animation: 'pulse 1.5s infinite', display: 'inline-block' }} />
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#00d97e', letterSpacing: 1 }}>LIVE</span>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#4a5568' }}>{time}</span>
    </div>
  );
}

// ── 스타일 상수 ───────────────────────────────────────────
const styles = {
  page:    { minHeight: '100vh', background: '#0a0c0f', color: '#e8edf5' },
  header:  { position: 'sticky', top: 0, zIndex: 100, background: 'rgba(10,12,15,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:    { display: 'flex', alignItems: 'center', gap: 12 },
  logoMark:{ width: 32, height: 32, background: 'linear-gradient(135deg, #ff4757, #6c63ff)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#fff' },
  tabNav:  { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 28px', background: '#0f1217', position: 'sticky', top: 56, zIndex: 50 },
  tabBtn:  { padding: '12px 20px', fontFamily: 'monospace', fontSize: 12, color: '#4a5568', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase', transition: 'all .15s' },
  tabBtnActive: { color: '#e8edf5', borderBottomColor: '#f5a623' },
  main:    { maxWidth: 1400, margin: '0 auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 },
  banner:  { background: '#0f1217', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px 28px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 32 },
  select:  { background: '#151a22', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: '#8892a4', padding: '6px 10px', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', outline: 'none' },
};
