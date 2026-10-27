import { Clapperboard, Film, GitBranch, Play, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

const navigation = [
  { id: 'drama', label: '漫剧工作台', href: '/drama', icon: Film },
  { id: 'learn', label: '制作教程', href: '/learn', icon: Play },
  { id: 'idea', label: '创意', href: '/', icon: Sparkles },
  { id: 'story', label: '故事', href: '/story', icon: GitBranch },
  { id: 'production', label: '制作', href: '/production', icon: Clapperboard },
  { id: 'playtest', label: '试玩', href: '/playtest', icon: Play },
  { id: 'publish', label: '发布', href: '/publish', icon: Film },
] as const;

export function StudioPageShell({
  active,
  eyebrow,
  title,
  description,
  status,
  children,
  aside,
}: {
  active: (typeof navigation)[number]['id'];
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center border-b border-border bg-[color:var(--chrome)] px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="grid size-8 place-items-center border border-[color:var(--signal)]/40 bg-[color:var(--signal)]/10 text-[color:var(--signal)]">
            <Clapperboard className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">FilmGame Studio</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Comic Drama / Interactive Film</p>
          </div>
        </Link>
        <Badge variant="outline" className="ml-auto border-emerald-400/25 bg-emerald-400/8 text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {status}
        </Badge>
      </header>
      <nav aria-label="移动端创作流程" className="flex gap-4 overflow-x-auto border-b border-border px-4 py-3 text-sm lg:hidden">
        {navigation.map(({ id, label, href }) => <Link key={id} href={href} className={`shrink-0 ${id === active ? 'text-[color:var(--signal)]' : 'text-muted-foreground'}`}>{label}</Link>)}
      </nav>

      <div className={`grid min-h-[calc(100vh-3.5rem)] ${aside ? 'lg:grid-cols-[196px_minmax(0,1fr)_300px]' : 'lg:grid-cols-[196px_minmax(0,1fr)]'}`}>
        <aside className="hidden border-r border-border bg-[color:var(--chrome)] p-3 lg:block">
          <nav aria-label="创作流程" className="space-y-1">
            {navigation.map(({ id, label, href, icon: Icon }) => {
              const selected = id === active;
              return (
                <Link
                  key={id}
                  href={href}
                  aria-current={selected ? 'page' : undefined}
                  className={`flex h-10 items-center gap-3 border px-3 text-sm transition-colors ${selected ? 'border-[color:var(--signal)]/25 bg-[color:var(--signal)]/9 text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'}`}
                >
                  <Icon className={`size-4 ${selected ? 'text-[color:var(--signal)]' : ''}`} />
                  {label}
                  {selected ? <span className="ml-auto size-1.5 bg-[color:var(--signal)]" /> : null}
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0 bg-[radial-gradient(circle_at_80%_0%,var(--signal-glow),transparent_26%)] p-4 sm:p-6 xl:p-8">
          <div className="mx-auto max-w-6xl">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[color:var(--signal)]">{eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
            <div className="mt-6">{children}</div>
          </div>
        </section>

        {aside ? <aside className="hidden border-l border-border bg-[color:var(--chrome)] p-4 lg:block">{aside}</aside> : null}
      </div>
    </main>
  );
}

