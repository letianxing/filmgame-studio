import { CompanionClient } from '@/components/companion-client';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ roomId?: string; projectId?: string; runtimeVersion?: string }>;
}) {
  const params = await searchParams;
  const runtimeVersion = Number(params.runtimeVersion ?? 1);
  return (
    <CompanionClient
      defaultServerUrl={process.env.NEXT_PUBLIC_COLYSEUS_SERVER_URL ?? 'ws://127.0.0.1:2567'}
      initialRoomId={params.roomId ?? ''}
      projectId={params.projectId ?? 'snowbound-hotel'}
      runtimeVersion={Number.isInteger(runtimeVersion) && runtimeVersion > 0 ? runtimeVersion : 1}
    />
  );
}
