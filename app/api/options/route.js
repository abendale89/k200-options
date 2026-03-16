/**
 * /app/api/options/route.js
 * KRX 코스피200 옵션 미결제약정 프록시
 * GET /api/options?exp=weekly|monthly
 */

export const runtime = 'edge';

// KRX 엔드포인트 & 종목코드
const KRX_BASE = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

// 위클리/먼슬리 ISU 코드 (매주 갱신 필요 — KRX에서 확인)
const SERIES_CODE = {
  weekly:  '20',   // 위클리 시리즈 코드
  monthly: '10',   // 먼슬리 시리즈 코드
};

async function fetchKRX(bld, params) {
  const body = new URLSearchParams({ bld, ...params });
  const res = await fetch(KRX_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': 'https://data.krx.co.kr/',
      'User-Agent': 'Mozilla/5.0 (compatible; K200-OPT/1.0)',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`KRX HTTP ${res.status}`);
  return res.json();
}

function getToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const exp = searchParams.get('exp') || 'monthly';
  const today = getToday();

  try {
    // ── 1. 옵션 미결제약정 (행사가별 콜/풋 OI)
    const oiData = await fetchKRX('dbms/MDC/STAT/standard/MDCSTAT12301', {
      trdDd: today,
      mktTpCd: '3',         // 옵션 시장
      prodId: 'KR4101C',    // 코스피200 콜 기준 (풋은 KR4101P)
      isuSrtCd: SERIES_CODE[exp],
    });

    // ── 2. 투자자별 거래 (외국인/기관/개인)
    const investorData = await fetchKRX('dbms/MDC/STAT/standard/MDCSTAT12401', {
      trdDd: today,
      mktTpCd: '3',
      prodId: 'KR4101',
    });

    // ── 3. 코스피200 현재지수
    const idxData = await fetchKRX('dbms/MDC/STAT/standard/MDCSTAT00101', {
      trdDd: today,
      idxIndMktTpCd: '2',
      idxIndClssCode: '001',
    });

    // ── 파싱: OI 행사가별
    const strikes = [];
    if (oiData?.OutBlock_1) {
      for (const row of oiData.OutBlock_1) {
        strikes.push({
          strike: parseFloat(row.EXER_PRC || 0),
          callOI: parseInt((row.CALL_OPN_INT || '0').replace(/,/g, ''), 10),
          putOI:  parseInt((row.PUT_OPN_INT  || '0').replace(/,/g, ''), 10),
          callVol: parseInt((row.CALL_ACC_TRDVOL || '0').replace(/,/g, ''), 10),
          putVol:  parseInt((row.PUT_ACC_TRDVOL  || '0').replace(/,/g, ''), 10),
          callOIChg: parseInt((row.CALL_OPN_INT_CHG || '0').replace(/,/g, ''), 10),
          putOIChg:  parseInt((row.PUT_OPN_INT_CHG  || '0').replace(/,/g, ''), 10),
        });
      }
    }

    // ── 파싱: 투자자
    const investors = { foreign: {}, institution: {}, individual: {} };
    if (investorData?.OutBlock_1) {
      for (const row of investorData.OutBlock_1) {
        const key = row.INVST_TP_NM === '외국인' ? 'foreign'
                  : row.INVST_TP_NM === '기관'   ? 'institution'
                  : row.INVST_TP_NM === '개인'   ? 'individual' : null;
        if (!key) continue;
        investors[key] = {
          callBuy:  parseInt((row.CALL_BUY_TRDVOL  || '0').replace(/,/g, ''), 10),
          callSell: parseInt((row.CALL_SELL_TRDVOL || '0').replace(/,/g, ''), 10),
          putBuy:   parseInt((row.PUT_BUY_TRDVOL   || '0').replace(/,/g, ''), 10),
          putSell:  parseInt((row.PUT_SELL_TRDVOL  || '0').replace(/,/g, ''), 10),
        };
        investors[key].callNet = investors[key].callBuy - investors[key].callSell;
        investors[key].putNet  = investors[key].putBuy  - investors[key].putSell;
      }
    }

    // ── 파싱: 지수
    let index = { value: 0, change: 0, changePct: 0, high: 0, low: 0, volume: 0 };
    if (idxData?.OutBlock_1) {
      const row = idxData.OutBlock_1.find(r => r.IDX_NM?.includes('코스피 200'));
      if (row) {
        index = {
          value:     parseFloat((row.CLSPRC_IDX  || '0').replace(/,/g, '')),
          change:    parseFloat((row.FLUC_TP_CD === '2' ? '-' : '') + (row.PRV_DD_CMPR || '0').replace(/,/g, '')),
          changePct: parseFloat((row.FLUC_TP_CD === '2' ? '-' : '') + (row.UPDN_RATE   || '0').replace(/,/g, '')),
          high:      parseFloat((row.HGPRC_IDX   || '0').replace(/,/g, '')),
          low:       parseFloat((row.LWPRC_IDX   || '0').replace(/,/g, '')),
          volume:    parseInt((row.ACC_TRDVOL    || '0').replace(/,/g, ''), 10),
        };
      }
    }

    // ── 집계
    const totalCallOI = strikes.reduce((s, r) => s + r.callOI, 0);
    const totalPutOI  = strikes.reduce((s, r) => s + r.putOI,  0);
    const pcr = totalCallOI > 0 ? (totalPutOI / totalCallOI) : 0;

    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      exp,
      index,
      strikes,
      summary: { totalCallOI, totalPutOI, pcr },
      investors,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });

  } catch (err) {
    // KRX 연결 실패 시 시뮬레이션 데이터로 fallback
    console.error('KRX fetch error:', err.message);
    return Response.json({
      ok: false,
      error: err.message,
      fallback: true,
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  }
}
