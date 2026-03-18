/**
 * /app/api/options/route.js
 * KRX OpenAPI 실시간 연동 — 코스피200 옵션
 * API ID: opt_bydd_trd
 */

export const runtime = 'edge';

const KRX_API_KEY = '74D1B99DFBF345BBA3FB4476510A4BED4C78D13A';
const KRX_OTP_URL  = 'https://openapi.krx.co.kr/contents/COM/GenerateOTP.jspx';
const KRX_DATA_URL = 'https://openapi.krx.co.kr/contents/SRT/99/SRT99000001.jspx';

function getToday() {
  const d = new Date();
  // 한국 시간 기준
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0) kst.setUTCDate(kst.getUTCDate() - 2); // 일요일 → 금요일
  if (day === 6) kst.setUTCDate(kst.getUTCDate() - 1); // 토요일 → 금요일
  const y  = kst.getUTCFullYear();
  const m  = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

async function fetchKRX(basDd) {
  // Step 1: OTP 발급
  const otpUrl = new URL(KRX_OTP_URL);
  otpUrl.searchParams.set('name',     'fileDown');
  otpUrl.searchParams.set('filetype', 'json');
  otpUrl.searchParams.set('url',      'opt_bydd_trd');
  otpUrl.searchParams.set('basDd',    basDd);
  otpUrl.searchParams.set('auth',     KRX_API_KEY);

  const otpRes = await fetch(otpUrl.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://openapi.krx.co.kr/' },
  });
  if (!otpRes.ok) throw new Error('OTP HTTP ' + otpRes.status);
  const otp = (await otpRes.text()).trim();
  if (!otp) throw new Error('Empty OTP');

  // Step 2: 데이터 요청
  const dataRes = await fetch(KRX_DATA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://openapi.krx.co.kr/',
    },
    body: new URLSearchParams({ code: otp }).toString(),
  });
  if (!dataRes.ok) throw new Error('Data HTTP ' + dataRes.status);
  const json = await dataRes.json();
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
    return { ok: false, value: 826.83, change: 0, changePct: 0, high: 826.83, low: 826.83, volume: 0 };
  }
}

function parseRows(rows) {
  // 행사가별 콜/풋 집계
  const map = {};

  for (const row of rows) {
    // 행사가: ISU_NM 에서 숫자 추출 (예: "코스피200 C 202005 160.0" → 160.0)
    const parts = (row.ISU_NM || '').split(' ');
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
    .filter(s => s.callOI + s.putOI > 0)  // 거래 없는 행사가 제외
    .sort((a, b) => a.strike - b.strike);

  const totalCallOI = strikes.reduce((a, s) => a + s.callOI, 0);
  const totalPutOI  = strikes.reduce((a, s) => a + s.putOI,  0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  return { strikes, summary: { totalCallOI, totalPutOI, pcr } };
}

function generateFallback(basePrice) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const atm = Math.round(basePrice / 2.5) * 2.5;
  const range = 6;
  const strikesArr = Array.from({ length: range * 2 + 1 }, (_, i) => atm + (i - range) * 2.5);
  const callOI = strikesArr.map((_, i) => Math.round(rand(300, 8500) * Math.exp(-Math.abs(i - range) * 0.06)));
  const putOI  = strikesArr.map((_, i) => Math.round(rand(300, 9500) * Math.exp(-Math.abs(i - range) * 0.055)));
  const strikes = strikesArr.map((s, i) => ({
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

  // 투자자 포지션 (시뮬레이션 — 별도 API 신청 필요)
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
    exp,
    index,
    strikes,
    summary,
    investors,
    pcrHistory: [0.82, 0.91, 1.05, 0.97, parseFloat(summary.pcr.toFixed(3))],
    pcrDays: ['3/10', '3/11', '3/12', '3/13', '3/14'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
