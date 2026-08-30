import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'FilmGame Companion — 雪封山庄',
  description: '多人互动影游角色身份、秘密、线索与动作终端。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

