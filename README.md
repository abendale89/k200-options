# K200 OPT — 코스피200 옵션 포지션 분석 대시보드

실시간 KRX 데이터 기반 코스피200 위클리/먼슬리 옵션 포지션 분석 웹사이트

---

## 파일 구조

```
k200-options/
├── app/
│   ├── api/
│   │   ├── options/route.js   ← KRX 옵션 OI 프록시
│   │   └── pcr/route.js       ← PCR 히스토리 프록시
│   ├── globals.css
│   ├── layout.js
│   └── page.js                ← 메인 대시보드
├── next.config.js
├── package.json
└── README.md
```

---

## 로컬 실행

```bash
# 1. 의존성 설치
npm install

# 2. 개발 서버 실행
npm run dev

# 3. 브라우저에서 열기
open http://localhost:3000
```

---

## Vercel 배포 (무료)

### Step 1 — GitHub 업로드

```bash
git init
git add .
git commit -m "init: k200 options dashboard"

# GitHub에서 새 repo 생성 후:
git remote add origin https://github.com/YOUR_USERNAME/k200-options.git
git push -u origin main
```

### Step 2 — Vercel 연결

1. [vercel.com](https://vercel.com) 접속 → GitHub 로그인
2. **"New Project"** 클릭
3. `k200-options` repo 선택 → **"Deploy"** 클릭
4. 약 1분 후 배포 완료

→ `https://k200-options.vercel.app` 으로 어디서든 접근 가능

### Step 3 — 자동 재배포

이후 `git push` 할 때마다 Vercel이 자동으로 재배포합니다.

---

## 실제 데이터 연동

현재는 KRX API 연결 실패 시 시뮬레이션 데이터로 자동 fallback됩니다.

KRX 실시간 데이터를 안정적으로 받으려면:

1. [data.krx.co.kr](https://data.krx.co.kr) → 회원가입
2. API 이용 신청 (무료)
3. `app/api/options/route.js` 내 `SERIES_CODE` 값을 실제 만기 종목코드로 업데이트

```js
// 매주 만기 종목코드 KRX에서 확인 후 업데이트
const SERIES_CODE = {
  weekly:  '20',  // 실제 위클리 코드로 변경
  monthly: '10',  // 실제 먼슬리 코드로 변경
};
```

---

## 기술 스택

- **Next.js 14** (App Router)
- **Chart.js 4** (차트)
- **Vercel Edge Runtime** (API 프록시)
- **KRX 공공 데이터 API**
