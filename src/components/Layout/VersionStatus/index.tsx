import {
  ArrowUpCircleIcon,
  BeakerIcon,
  CodeBracketIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';
import type { StatusResponse } from '@server/interfaces/api/settingsInterfaces';
import Link from 'next/link';
import useSWR from 'swr';

interface VersionStatusProps {
  onClick?: () => void;
}

const VersionStatus = ({ onClick }: VersionStatusProps) => {
  const { data } = useSWR<StatusResponse>('/api/v1/status', {
    refreshInterval: 60 * 1000,
  });

  if (!data) {
    return null;
  }

  return (
    <Link
      href="/settings/about"
      onClick={onClick}
      role="button"
      className={`mx-2 flex items-center rounded-lg p-2 text-xs ring-1 ring-gray-700 transition duration-300 ${
        data.updateAvailable
          ? 'bg-yellow-500 text-white hover:bg-yellow-400'
          : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
      }`}
    >
      {data.commitTag === 'local' ? (
        <CodeBracketIcon className="h-6 w-6" />
      ) : data.version.startsWith('develop-') ? (
        <BeakerIcon className="h-6 w-6" />
      ) : (
        <ServerIcon className="h-6 w-6" />
      )}
      <div className="flex min-w-0 flex-1 flex-col truncate px-2">
        <span className="font-bold">
          {`Forked from v${data.forkedFromVersion}`}
        </span>
        <span className="truncate">
          Main repository v{data.mainProjectVersion || data.forkedFromVersion}
        </span>
      </div>
      {data.updateAvailable && <ArrowUpCircleIcon className="h-6 w-6" />}
    </Link>
  );
};

export default VersionStatus;
