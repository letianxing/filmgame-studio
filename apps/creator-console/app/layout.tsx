import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'FilmGame Studio — AI 漫剧与互动影游创作台',
  description:
    '用自然语言创作 AI 漫剧与互动影游，从剧本、角色、分镜到配音和整集成片。',
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
