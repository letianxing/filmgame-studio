'use client';

import { Bot, LoaderCircle, Radio } from 'lucide-react';
import Image from 'next/image';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';

export function PlaytestControls({
  projectId,
  companionBaseUrl,
  initialRoomId,
  runtimeVersion,
  initialReport,
}: {
  projectId?: string;
  companionBaseUrl: string;
  initialRoomId?: string;
  runtimeVersion?: number;
  initialReport?: BotReport;
}) {
  const [roomId, setRoomId] = useState(initialRoomId ?? '');
  const [activeRuntimeVersion, setActiveRuntimeVersion] = useState(runtimeVersion);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [qr, setQr] = useState('');
  const [report, setReport] = useState<BotReport | undefined>(initialReport);
  const joinUrl = useMemo(() => {
    if (!projectId || !roomId || !activeRuntimeVersion) return '';
    const url = new URL(companionBaseUrl);
    url.searchParams.set('roomId', roomId);
    url.searchParams.set('projectId', projectId);
    url.searchParams.set('runtimeVersion', String(activeRuntimeVersion));
    return url.toString();
  }, [activeRuntimeVersion, companionBaseUrl, projectId, roomId]);

  useEffect(() => {
    let active = true;
    if (!joinUrl) {
      return () => {
        active = false;
      };
    }
    void QRCode.toDataURL(joinUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#e7edf5', light: '#0a1018' },
    }).then((value) => {
      if (active) setQr(value);
    });
    return () => {
      active = false;
    };
  }, [joinUrl]);

  async function createRoom(): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/playtest`, {
        method: 'POST',
      });
      const payload = (await response.json()) as {
        colyseusRoomId?: string;
        room?: { runtime_version?: number };
        error?: string;
        productionStatus?: string | null;
      };
      if (!response.ok || !payload.colyseusRoomId) {
        throw new Error(
          payload.productionStatus
            ? `${payload.error}: Production ${payload.productionStatus}`
            : payload.error ?? `HTTP ${response.status}`,
        );
      }
      setRoomId(payload.colyseusRoomId);
      setActiveRuntimeVersion(payload.room?.runtime_version);
      setMessage('试玩房间已创建；可让玩家扫码加入。');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '无法创建试玩房间');
    } finally {
      setBusy(false);
    }
  }

  async function runBotPlaytest(): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/playtest`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxTransitions: 512 }),
      });
      const payload = (await response.json()) as { report?: BotReport; error?: string };
      if (!response.ok || !payload.report) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setReport(payload.report);
      setMessage('确定性 Bot 路径分析已完成并保存。');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'AI Bot 试玩失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
      <div>
        <Button disabled={!projectId || busy} onClick={() => void createRoom()}>
          {busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Radio data-icon="inline-start" />}
          创建权威试玩房间
        </Button>
        <Button className="ml-2" variant="outline" disabled={!projectId || busy} onClick={() => void runBotPlaytest()}>
          <Bot data-icon="inline-start" />AI Bot 路径覆盖
        </Button>
        {roomId ? <p className="mt-3 font-mono text-xs text-[color:var(--signal)]">Room {roomId}</p> : null}
        {joinUrl ? <a className="mt-2 block break-all text-xs underline underline-offset-4" href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a> : null}
        {message ? <p className="mt-3 text-xs text-amber-100">{message}</p> : null}
        {report ? (
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <span className="border border-border p-2">裁决 {report.transitionsEvaluated}</span>
            <span className="border border-border p-2">路径 {report.paths.length}</span>
            <span className="border border-border p-2">结局覆盖 {Object.keys(report.endingCoverage).length}</span>
          </div>
        ) : null}
      </div>
      {joinUrl && qr ? <Image src={qr} width={180} height={180} unoptimized alt="玩家扫码加入试玩房间" className="size-[180px] border border-border bg-[#0a1018] p-2" /> : null}
    </div>
  );
}

interface BotReport {
  transitionsEvaluated: number;
  paths: unknown[];
  endingCoverage: Record<string, number>;
}
