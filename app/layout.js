import './globals.css';

export const metadata = {
  title: 'K200 OPT — 코스피200 옵션 포지션 분석',
  description: '코스피200 위클리/먼슬리 옵션 실시간 포지션 분석 대시보드',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Noto+Sans+KR:wght@300;400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
