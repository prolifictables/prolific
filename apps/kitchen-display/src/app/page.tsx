import KdsClient from './kds-client';

interface PageProps {
  searchParams: { branchId?: string };
}

export default function KdsPage({ searchParams }: PageProps) {
  const branchId = searchParams.branchId || process.env.NEXT_PUBLIC_KDS_BRANCH_ID || '';
  const kdsToken = process.env.NEXT_PUBLIC_KDS_JWT || null;

  return (
    <KdsClientBootstrap branchId={branchId} kdsToken={kdsToken} />
  );
}

function KdsClientBootstrap({
  branchId,
  kdsToken,
}: {
  branchId: string;
  kdsToken: string | null;
}) {
  return <KdsClient branchId={branchId} kdsToken={kdsToken} />;
}
