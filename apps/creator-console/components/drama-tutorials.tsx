'use client';
import { useState } from 'react';
import Link from 'next/link';
import { dramaTutorials } from '@/lib/drama-tutorials';

export function DramaTutorials({ onUse }: { onUse?: (prompt: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-muted-foreground">跟着制作步骤学习，再把提示词带回自己的项目。教程由原作者在 B 站提供，点击后加载原站播放器；若无法播放，可直接前往 B 站。条目已核对简介和章节，未逐集评测。</p>
    <div className="grid gap-4 md:grid-cols-2">
      {dramaTutorials.map((item) => <article key={item.id} className="border border-border bg-card/60 p-5">
        <p className="text-xs text-[color:var(--signal)]">{item.stage}</p>
        <h2 className="mt-2 text-lg font-semibold">{item.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
        <p className="mt-3 text-xs text-muted-foreground">来源：{item.source} · {item.sourceTitle} · P{item.page}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <button className="underline underline-offset-4" onClick={() => setSelected(selected === item.id ? null : item.id)}>{selected === item.id ? '收起视频' : '在此观看'}</button>
          <a href={`https://www.bilibili.com/video/${item.bvid}/?p=${item.page}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">B 站原视频 ↗</a>
          {onUse ? <button className="text-[color:var(--signal)]" onClick={() => onUse(item.prompt)}>使用创作提示词</button>
            : <Link className="text-[color:var(--signal)]" href={`/drama?lesson=${item.id}`}>带着提示词去创作 →</Link>}
        </div>
        {selected === item.id ? <iframe className="mt-4 aspect-video w-full border-0" title={item.title}
          src={`https://player.bilibili.com/player.html?bvid=${item.bvid}&page=${item.page}&autoplay=0`}
          loading="lazy" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : null}
      </article>)}
    </div>
  </div>;
}
