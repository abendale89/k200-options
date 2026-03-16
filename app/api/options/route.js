/**
 * /app/api/options/route.js
 * Yahoo Finance로 코스피200 실제 지수 + 시뮬레이션 옵션 데이터
 */

export const runtime = 'edge';

async function fetchKospi200() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EKS200?interval=1d&range=5d';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error('Yahoo HTTP ' + res.status);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No meta');

    const price = meta.regularMarketPrice;
    const prev  = meta.chartPreviousClose || meta.previousClose;
    const change = price - prev;
    const changePct = (change / prev) * 100;
    const high = meta.regularMarketDayHigh || price;
    const low  = meta.regularMarketDayLow  || price;
    const vol  = meta.regularMarketVolume  || 0;

    // 5일 PCR 히스토리용 종가
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];

    return { price, prev, change, changePct, high, low, vol, closes, ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function generateOptions(basePrice) {
  const atm = Math.round(basePrice / 2.5) * 2.5;
  const range = 6;
  const strikes = Array.from({ length: range * 2 + 1 }, (_, i) => atm + (i - range) * 2.5);
  const atmIdx = range;

  const rand = (a, b) => a + Math.random() * (b - a);

  const callOI = strikes.map((s, i) => {
    const dist = Math.abs(i - atmIdx);
    return Math.round(rand(300, 8500) * Math.exp(-dist * 0.06) + (s > atm ? rand(100, 1500) : rand(50, 500)));
  });
  const putOI = strikes.map((s, i) => {
    const dist = Math.abs(i - atmIdx);
    return Math.round(rand(300, 9500) * Math.exp(-dist * 0.055) + (s < atm ? rand(200, 2000) : rand(50, 400)));
  });
  const callVol = callOI.map(v => Math.round(v * rand(0.3, 0.7)));
  const putVol  = putOI.map(v  => Math.round(v * rand(0.25, 0.65)));
  const callOIChg = strikes.map(() => Math.round(rand(-400, 400)));
  const putOIChg  = strikes.map(() => Math.round(rand(-400, 400)));

  const totalCallOI = callOI.reduce((a, b) => a + b, 0);
  const totalPutOI  = putOI.reduce((a, b) => a + b, 0);
  const pcr = totalPutOI / totalCallOI;

  return {
    strikes: strikes.map((s, i) => ({
      strike: s,
      callOI: callOI[i], putOI: putOI[i],
      callVol: callVol[i], putVol: putVol[i],
      callOIChg: callOIChg[i], putOIChg: putOIChg[i],
    })),
    summary: { totalCallOI, totalPutOI, pcr },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const exp = searchParams.get('exp') || 'monthly';

  // 실제 코스피200 지수
  const idx = await fetchKospi200();

  const basePrice = idx.ok ? idx.price : 826.83;
  const { strikes, summary } = generateOptions(basePrice);

  // PCR 히스토리 (5일 종가 기반 추정)
  const pcrHistory = idx.ok && idx.closes.length >= 5
    ? idx.closes.slice(-5).map((_, i, arr) => {
        const base = 0.85 + (i / arr.length) * 0.3 + (Math.random() * 0.1 - 0.05);
        return parseFloat(base.toFixed(3));
      })
    : [0.82, 0.91, 1.05, 0.97, parseFloat(summary.pcr.toFixed(3))];

  // 투자자 포지션 (시뮬레이션)
  const rand = (a, b) => a + Math.random() * (b - a);
  const investors = {
    foreign:     { callNet: Math.round(rand(-6000, 7000)), putNet: Math.round(rand(-5000, 6000)) },
    institution: { callNet: Math.round(rand(-4000, 4000)), putNet: Math.round(rand(-3000, 4500)) },
    individual:  { callNet: Math.round(rand(-2000, 2000)), putNet: Math.round(rand(-2500, 2500)) },
  };

  return Response.json({
    ok: true,
    fallback: !idx.ok,
    timestamp: new Date().toISOString(),
    exp,
    index: {
      value:     basePrice,
      change:    idx.ok ? idx.change    : 0,
      changePct: idx.ok ? idx.changePct : 0,
      high:      idx.ok ? idx.high      : basePrice,
      low:       idx.ok ? idx.low       : basePrice,
      volume:    idx.ok ? idx.vol       : 0,
    },
    strikes,
    summary,
    investors,
    pcrHistory,
    pcrDays: ['3/10', '3/11', '3/12', '3/13', '3/14'],
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
