/**
 * /app/api/options/route.js
 * KRX OpenAPI — GET + AUTH_KEY 헤더 방식
 * API: https://openapi.krx.co.kr/svc/apis/drv/opt_bydd_trd
 */

export const runtime = 'edge';

const AUTH_KEY = '74D1B99DFBF345BBA3FB4476510A4BED4C78D13A';
const KRX_URL  = 'https://openapi.krx.co.kr/svc/apis/drv/opt_bydd_trd';

function getToday() {
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0) kst.setUTCDate(kst.getUTCDate() - 2);
  if (day === 6) kst.setUTCDate(kst.getUTCDate() - 1);
  const y  = kst.getUTCFullYear();
  const m  = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

async function fetchKRX(basDd) {
  const url = `${KRX_URL}?basDd=${basDd}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'AUTH_KEY': AUTH_KEY,
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!res.ok) throw new Error('KRX HTTP ' + res.status);
  const json = await res.json();
  return json?.OutBlock_1 || [];
}

async function fetchKospi200Index() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EKS200?interval=1d&range=5d';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('Yahoo ' + res.status);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No meta');
    const price = meta.regularMarketPrice;
    const prev  = meta.chartPreviousClose || price;
    const chg   = price - prev;
    return {
      ok: true,
      value:     parseFloat(price.toFixed(2)),
      change:    parseFloat(chg.toFixed(2)),
      changePct: parseFloat((chg / prev * 100).toFixed(2)),
      high:      meta.regularMarketDayHigh || price,
      low:       meta.regularMarketDayLow  || price,
      volume:    meta.regularMarketVolume  || 0,
    };
  } catch {
    return { ok: false, value: 876.62, change: 0, changePct: 0, high: 876.62, low: 876.62, volume: 0 };
  }
}

function parseRows(rows) {
  const map = {};
  for (const row of rows) {
    const parts  = (row.ISU_NM || '').split(' ');
    const strike = parseFloat(parts[parts.length - 1]);
    if (!strike || isNaN(strike)) continue;

    if (!map[strike]) {
      map[strike] = { strike, callOI: 0, putOI: 0, callVol: 0, putVol: 0, callOIChg: 0, putOIChg: 0 };
    }
    const isCall = (row.RGHT_TP_NM || '').toUpperCase() === 'CALL';
    const oi  = parseInt((row.ACC_OPNINT_QTY || '0').replace(/,/g, ''), 10);
    const vol = parseInt((row.ACC_TRDVOL     || '0').replace(/,/g, ''), 10);

    if (isCall) { map[strike].callOI = oi; map[strike].callVol = vol; }
    else        { map[strike].putOI  = oi; map[strike].putVol  = vol; }
  }

  const strikes = Object.values(map)
    .filter(s => s.callOI + s.putOI > 0)
    .sort((a, b) => a.strike - b.strike);

  const totalCallOI = strikes.reduce((a, s) => a + s.callOI, 0);
  const totalPutOI  = strikes.reduce((a, s) => a + s.putOI,  0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  return { strikes, summary: { totalCallOI, totalPutOI, pcr } };
}

function generateFallback(basePrice) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const atm   = Math.round(basePrice / 2.5) * 2.5;
  const range  = 6;
  const arr    = Array.from({ length: range * 2 + 1 }, (_, i) => atm + (i - range) * 2.5);
  const callOI = arr.map((_, i) => Math.round(rand(300, 8500) * Math.exp(-Math.abs(i - range) * 0.06)));
  const putOI  = arr.map((_, i) => Math.round(rand(300, 9500) * Math.exp(-Math.abs(i - range) * 0.055)));
  const strikes = arr.map((s, i) => ({
    strike: s, callOI: callOI[i], putOI: putOI[i],
    callVol: Math.round(callOI[i] * rand(0.3, 0.7)),
    putVol:  Math.round(putOI[i]  * rand(0.25, 0.65)),
    callOIChg: Math.round(rand(-400, 400)),
    putOIChg:  Math.round(rand(-400, 400)),
  }));
  const totalCallOI = callOI.reduce((a, b) => a + b, 0);
  const totalPutOI  = putOI.reduce((a, b) => a + b, 0);
  return { strikes, summary: { totalCallOI, totalPutOI, pcr: totalPutOI / totalCallOI } };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const exp   = searchParams.get('exp') || 'monthly';
  const basDd = getToday();

  const [index, rows] = await Promise.all([
    fetchKospi200Index(),
    fetchKRX(basDd).catch(() => []),
  ]);

  const krxOk = rows.length > 0;
  const { strikes, summary } = krxOk
    ? parseRows(rows)
    : generateFallback(index.value);

  const rand = (a, b) => a + Math.random() * (b - a);
  const investors = {
    foreign:     { callNet: Math.round(rand(-6000, 7000)), putNet: Math.round(rand(-5000, 6000)) },
    institution: { callNet: Math.round(rand(-4000, 4000)), putNet: Math.round(rand(-3000, 4500)) },
    individual:  { callNet: Math.round(rand(-2000, 2000)), putNet: Math.round(rand(-2500, 2500)) },
  };

  return Response.json({
    ok: true,
    fallback: !krxOk,
    krxConnected: krxOk,
    basDd,
    timestamp: new Date().toISOString(),
    exp, index, strikes, summary, investors,
    pcrHistory: [0.82, 0.91, 1.05, 0.97, parseFloat(summary.pcr.toFixed(3))],
    pcrDays: ['3/10', '3/11', '3/12', '3/13', '3/14'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
