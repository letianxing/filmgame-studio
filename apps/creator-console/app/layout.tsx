import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'FilmGame Studio — AI 多人互动影游创作台',
  description:
    '用自然语言设计、生成、试玩、迭代并发布 4～8 人多人互动影游。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
