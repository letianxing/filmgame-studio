'use client';

import { Client, type Room } from '@colyseus/sdk';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Radio,
  Send,
  Shield,
  Users,
} from 'lucide-react';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'LOBBY' | 'PLAYING' | 'ENDING' | 'ERROR';

type PrivateState = {
  roleId: string;
  identity: string;
  publicProfile: { role: string; summary: string };
  secrets: Array<{ id: string; summary: string }>;
  goals: Array<{ id: string; description: string }>;
  victoryConditions: Array<{ id: string; description: string }>;
  evidenceIds: string[];
  inventoryIds: string[];
  privateInformation: string[];
  availableActions: Array<{ id: string; label: string; inputMode: string }>;
};

type PublicRoomState = {
  phase?: string;
  sceneId?: string;
  timerEndsAt?: string;
  endingId?: string;
};

export function CompanionClient({
  defaultServerUrl,
  initialRoomId,
  projectId,
  runtimeVersion,
}: {
  defaultServerUrl: string;
  initialRoomId: string;
  projectId: string;
  runtimeVersion: number;
}) {
  const roomRef = useRef<Room | null>(null);
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [roomId, setRoomId] = useState(initialRoomId);
  const [playerName, setPlayerName] = useState('林遥');
  const [requestedRoleId, setRequestedRoleId] = useState('journalist');
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [publicState, setPublicState] = useState<PublicRoomState>({});
  const [privateState, setPrivateState] = useState<PrivateState | null>(null);
  const [selectedActionId, setSelectedActionId] = useState('');
  const [error, setError] = useState('');

  async function join(): Promise<void> {
    setStatus('CONNECTING');
    setError('');
    try {
      const client = new Client(serverUrl);
      const options = {
        authToken: playerName.trim() || 'player',
        requestedRoleId,
        projectId,
        runtimeVersion,
      };
      const room = roomId.trim()
        ? await client.joinById(roomId.trim(), options)
        : await client.joinOrCreate('story', options);
      roomRef.current = room;
      room.onMessage<PrivateState>('privateState', (payload) => {
        setPrivateState(payload);
        setSelectedActionId(payload.availableActions[0]?.id ?? '');
      });
      room.onMessage<{ code: string; message: string }>('error', (payload) => {
        setError(`${payload.code}: ${payload.message}`);
      });
      room.onStateChange((state: PublicRoomState) => {
        setPublicState({
          phase: state.phase,
          sceneId: state.sceneId,
          timerEndsAt: state.timerEndsAt,
          endingId: state.endingId,
        });
        setStatus(state.phase === 'ENDING' ? 'ENDING' : state.phase === 'PLAYING' ? 'PLAYING' : 'LOBBY');
      });
      room.onLeave(() => {
        roomRef.current = null;
        setStatus('DISCONNECTED');
      });
      room.send('requestPrivateState');
      setRoomId(room.roomId);
      setStatus('LOBBY');
    } catch (cause) {
      setStatus('ERROR');
      setError(cause instanceof Error ? cause.message : '无法加入房间');
    }
  }

  function ready(): void {
    roomRef.current?.send('ready', { ready: true });
  }

  function submitAction(): void {
    if (!selectedActionId) return;
    roomRef.current?.send('submitAction', { actionId: selectedActionId });
  }

  if (!privateState) {
    return (
      <div className="mx-auto grid min-h-screen max-w-md place-items-center px-5 py-10">
        <section className="w-full border border-border bg-card/90 shadow-[0_30px_100px_rgb(0_0_0/35%)]">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--signal)]"><Radio className="size-3.5" />Player companion</div>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">加入《雪封山庄》</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">手机只显示你的角色身份、秘密、线索和可执行动作。结局由服务器裁决。</p>
          </div>
          <div className="space-y-4 p-5">
            <Field label="服务器"><Input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></Field>
            <Field label="房间 ID（留空自动创建）"><Input value={roomId} onChange={(event) => setRoomId(event.target.value)} placeholder="例如 Q5HFX7Uzu" /></Field>
            <Field label="玩家名"><Input value={playerName} onChange={(event) => setPlayerName(event.target.value)} /></Field>
            <Field label="请求角色"><Input value={requestedRoleId} onChange={(event) => setRequestedRoleId(event.target.value)} /></Field>
            <Button className="h-10 w-full bg-[color:var(--signal)] text-slate-950 hover:bg-[color:var(--signal)]/85" disabled={status === 'CONNECTING'} onClick={() => void join()}>
              {status === 'CONNECTING' ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <ArrowRight data-icon="inline-start" />}
              {status === 'CONNECTING' ? '正在连接…' : '进入房间'}
            </Button>
            {error ? <p className="border border-destructive/30 bg-destructive/8 p-3 text-xs text-destructive">{error}</p> : null}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[10px] text-muted-foreground"><Shield className="size-3.5 text-emerald-300" />不在客户端保存权威游戏状态</div>
        </section>
      </div>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-md border-x border-border bg-[color:var(--phone)]">
      <header className="sticky top-0 z-10 border-b border-border bg-[color:var(--phone)]/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{privateState.publicProfile.role}</p><h1 className="mt-1 text-lg font-semibold">{privateState.identity}</h1></div><Badge variant="outline" className="border-emerald-400/25 text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" />{status}</Badge></div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground"><span className="font-mono">{roomId}</span><span className="flex items-center gap-1"><Clock3 className="size-3.5" />{publicState.timerEndsAt ? new Date(publicState.timerEndsAt).toLocaleTimeString('zh-CN') : '等待开始'}</span></div>
      </header>

      <div className="space-y-4 p-5 pb-32">
        <section className="border border-border bg-card/65 p-4"><div className="flex items-center gap-2 text-xs font-medium"><Fingerprint className="size-4 text-[color:var(--signal)]" />公开身份</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{privateState.publicProfile.summary}</p></section>
        <PrivatePanel title="你的秘密" icon={LockKeyhole} items={privateState.secrets.map((secret) => secret.summary)} danger />
        <PrivatePanel title="私人目标" icon={CheckCircle2} items={privateState.goals.map((goal) => goal.description)} />
        <PrivatePanel title="胜利条件" icon={Users} items={privateState.victoryConditions.map((condition) => condition.description)} />

        <section className="border border-border bg-card/65 p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium">当前场景</p><span className="font-mono text-[10px] text-[color:var(--signal)]">{publicState.sceneId ?? 'LOBBY'}</span></div><div className="mt-3 space-y-2">{privateState.privateInformation.length ? privateState.privateInformation.map((info) => <p key={info} className="border-l-2 border-[color:var(--signal)] pl-3 text-xs leading-5 text-muted-foreground">{info}</p>) : <p className="text-xs text-muted-foreground">当前没有额外私密信息。</p>}</div></section>

        <section className="border border-border bg-card/65 p-4"><div className="flex items-center gap-2 text-xs font-medium"><KeyRound className="size-4 text-[color:var(--signal)]" />线索与道具</div><div className="mt-3 flex flex-wrap gap-2">{[...privateState.evidenceIds, ...privateState.inventoryIds].map((item) => <Badge key={item} variant="outline" className="font-mono">{item}</Badge>)}</div></section>

        <section className="border border-[color:var(--signal)]/30 bg-[color:var(--signal)]/6 p-4"><p className="text-xs font-medium">可执行动作</p><div className="mt-3 space-y-2">{privateState.availableActions.map((action) => <button key={action.id} type="button" onClick={() => setSelectedActionId(action.id)} className={`flex w-full items-center justify-between border px-3 py-3 text-left text-sm ${selectedActionId === action.id ? 'border-[color:var(--signal)] bg-[color:var(--signal)]/10' : 'border-border bg-background/25'}`}><span>{action.label}</span>{selectedActionId === action.id ? <CheckCircle2 className="size-4 text-[color:var(--signal)]" /> : null}</button>)}</div></section>
      </div>

      <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-border bg-[color:var(--phone)]/96 p-4 backdrop-blur"><div className="grid grid-cols-2 gap-3"><Button variant="outline" className="h-10" onClick={ready}>准备完成</Button><Button className="h-10 bg-[color:var(--signal)] text-slate-950 hover:bg-[color:var(--signal)]/85" disabled={status !== 'PLAYING' || !selectedActionId} onClick={submitAction}><Send data-icon="inline-start" />提交动作</Button></div></footer>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-[11px] text-muted-foreground">{label}</span>{children}</label>; }

function PrivatePanel({ title, icon: Icon, items, danger = false }: { title: string; icon: typeof LockKeyhole; items: string[]; danger?: boolean }) { return <section className={`border p-4 ${danger ? 'border-red-400/25 bg-red-400/6' : 'border-border bg-card/65'}`}><div className={`flex items-center gap-2 text-xs font-medium ${danger ? 'text-red-200' : ''}`}><Icon className="size-4" />{title}</div><ul className="mt-3 space-y-2">{items.map((item) => <li key={item} className="text-xs leading-5 text-muted-foreground">{item}</li>)}</ul></section>; }
