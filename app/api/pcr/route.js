/**
 * /app/api/pcr/route.js
 * 최근 5거래일 PCR 히스토리
 * GET /api/pcr?exp=weekly|monthly
 */

export const runtime = 'edge';

const KRX_BASE = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

function getPastDates(n) {
  const dates = [];
  const d = new Date();
  while (dates.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dates.unshift(`${y}${m}${dd}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

async function fetchOISummary(date) {
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT12301',
    trdDd: date,
    mktTpCd: '3',
    prodId: 'KR4101',
  });
  const res = await fetch(KRX_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': 'https://data.krx.co.kr/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.OutBlock_1) return null;

  let callOI = 0, putOI = 0;
  for (const row of data.OutBlock_1) {
    callOI += parseInt((row.CALL_OPN_INT || '0').replace(/,/g, ''), 10);
    putOI  += parseInt((row.PUT_OPN_INT  || '0').replace(/,/g, ''), 10);
  }
  return { date, callOI, putOI, pcr: callOI > 0 ? putOI / callOI : 0 };
}

export async function GET() {
  const dates = getPastDates(5);
  try {
    const results = await Promise.all(dates.map(fetchOISummary));
    const history = results.filter(Boolean);
    return Response.json({ ok: true, history }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 200 });
  }
}
