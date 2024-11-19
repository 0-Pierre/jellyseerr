import Link from 'next/link';
import CachedImage from '@app/components/Common/CachedImage';
import { formatDuration } from '@server/utils/dateHelpers';
import { withProperties } from '@app/utils/typeHelpers';
import defineMessages from '@app/utils/defineMessages';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import useSettings from '@app/hooks/useSettings';

const isMovie = (media: MovieDetails | TvDetails): media is MovieDetails => {
  return (media as MovieDetails).title !== undefined;
};

const messages = defineMessages('components.JellyfinSessionCard', {
  statusPlaying: 'Playing',
  statusPaused: 'Paused'
});

interface JellyfinSessionCardProps {
  session: {
    Id: string;
    UserName: string;
    jellyseerrUser?: {
      id: number;
      displayName: string;
      avatar: string;
    };
    NowPlayingItem: {
      Id: string;
      Name: string;
      Type: string;
      PrimaryImageTag?: string;
      RunTimeTicks: number;
      BackdropImageTags?: string[];
      ProductionYear?: number;
      ProviderIds?: {
        Tmdb?: string;
      };
      ParentId?: string;
      AlbumPrimaryImageTag?: string;
      SeriesId?: string;
      SeriesBackdropImageTags?: string[];
      ParentBackdropImageTags?: string[];
      IndexNumber?: number;
      ParentIndexNumber?: number;
      SeriesName?: string;
      Artists?: string[];
    };
    PlayState: {
      PositionTicks: number;
      IsPaused: boolean;
    };
  };
}

const JellyfinSessionCardPlaceholder = () => {
  return (
    <div className="relative w-72 animate-pulse rounded-xl bg-gray-700 p-4 sm:w-96">
      <div className="w-20 sm:w-28">
        <div className="w-full" style={{ paddingBottom: '150%' }} />
      </div>
    </div>
  );
};

const JellyfinSessionCard = ({ session }: JellyfinSessionCardProps) => {
  const intl = useIntl();
  const { ref, inView } = useInView({
    triggerOnce: true,
  });
  const settings = useSettings();

  const protocol = settings.currentSettings.jellyfinSsl ? 'https' : 'http';
  const baseUrl = `${protocol}://${settings.currentSettings.jellyfinHostname}${settings.currentSettings.jellyfinBaseUrl || ''}`;

  const isMusic = session.NowPlayingItem.Type.toLowerCase() === 'audio';
  const isTvShow = session.NowPlayingItem.Type.toLowerCase() === 'episode';

  const getImageTag = () => {
    if (isMusic) {
      return session.NowPlayingItem.AlbumPrimaryImageTag || session.NowPlayingItem.PrimaryImageTag;
    }
    if (isTvShow) {
      return session.NowPlayingItem.SeriesBackdropImageTags?.[0] || session.NowPlayingItem.ParentBackdropImageTags?.[0];
    }
    return session.NowPlayingItem.BackdropImageTags?.[0];
  };

  const getImageInfo = () => {
    if (isMusic) {
      return {
        id: session.NowPlayingItem.ParentId,
        tag: getImageTag(),
        type: 'Backdrop'
      };
    }

    if (isTvShow || session.NowPlayingItem.Type.toLowerCase().includes('series')) {
      return {
        id: session.NowPlayingItem.SeriesId,
        tag: getImageTag(),
        type: 'Backdrop'
      };
    }

    return {
      id: session.NowPlayingItem.ParentId,
      tag: getImageTag(),
      type: 'Backdrop'
    };
  };

  const imageUrl = `${baseUrl}/Items/${getImageInfo().id}/Images/${getImageInfo().type}?maxWidth=384&tag=${getImageInfo().tag}&quality=100`;

  const [currentPosition, setCurrentPosition] = useState(
    Math.floor(session.PlayState.PositionTicks / 10_000_000)
  );

  const { data: tmdbData } = useSWR<MovieDetails | TvDetails>(
    session.NowPlayingItem.ProviderIds?.Tmdb
      ? `${
          session.NowPlayingItem.Type.toLowerCase().includes('movie')
            ? '/api/v1/movie/'
            : session.NowPlayingItem.Type.toLowerCase().includes('series')
              ? '/api/v1/tv/'
              : null
        }${session.NowPlayingItem.ProviderIds.Tmdb}`
      : null
  );

  const durationSeconds = Math.floor(session.NowPlayingItem.RunTimeTicks / 10_000_000);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (!session.PlayState.IsPaused) {
      timer = setInterval(() => {
        setCurrentPosition((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [session.PlayState.IsPaused]);

  useEffect(() => {
    setCurrentPosition(Math.floor(session.PlayState.PositionTicks / 10_000_000));
  }, [session.PlayState.PositionTicks]);

  if (!inView) {
    return <div ref={ref}><JellyfinSessionCardPlaceholder /></div>;
  }

  const getMediaUrl = () => {
    if (!tmdbData?.id) return undefined;

    const mediaType = session.NowPlayingItem.Type.toLowerCase().includes('series') ||
      session.NowPlayingItem.SeriesId
      ? 'tv'
      : 'movie';

    return `/${mediaType}/${tmdbData.id}`;
  };

  const mediaUrl = getMediaUrl();

  return (
    <div
      className="relative flex w-72 overflow-hidden rounded-xl bg-gray-800 bg-cover bg-center p-4 text-gray-400 shadow ring-1 ring-gray-700 sm:w-96"
      data-testid="jellyfin-card"
    >
      <div className="absolute" style={{ top: -30, left: 0 }}>
        <CachedImage
          type="tmdb"
          className="position: absolute; height: 100%; width: 100%; inset: 0px; object-fit: cover; color: transparent;"
          src={imageUrl}
          alt=""
        />
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(135deg, rgba(17, 24, 39, 0.47) 0%, rgb(17, 24, 39) 75%)' }} />
      </div>
      <div
        className="relative z-10 flex min-w-0 flex-1 flex-col pr-4"
        data-testid="jellyfin-card-title"
      >

        <div className="hidden text-xs font-medium text-white sm:flex">
          {session.NowPlayingItem.ProductionYear}
          {isTvShow && session.NowPlayingItem.SeriesName && (
            <>
              <span className="mx-2">-</span>
              <Link
                href={`/tv/${tmdbData?.id}`}
                className="hover:underline"
              >
                <span>{session.NowPlayingItem.SeriesName}</span>
              </Link>
            </>
          )}
          {isMusic && Array.isArray(session.NowPlayingItem.Artists) && session.NowPlayingItem.Artists.length > 0 && (
            <>
              <span className="mx-2">-</span>
              <span>{session.NowPlayingItem.Artists[0]}</span>
            </>
          )}
        </div>

        <Link href={mediaUrl ?? '#'} className="overflow-hidden overflow-ellipsis whitespace-nowrap text-base font-bold text-white hover:underline sm:text-lg">
          {tmdbData ? (
            isMovie(tmdbData) ? tmdbData.title : tmdbData.name
          ) : (
            <>
              {isTvShow && (
          <div>
            {session.NowPlayingItem.ParentIndexNumber && session.NowPlayingItem.IndexNumber
              ? `S${session.NowPlayingItem.ParentIndexNumber}:E${session.NowPlayingItem.IndexNumber} - `
              : ''
            }
            {session.NowPlayingItem.Name}
          </div>
              )}
              {!isTvShow && session.NowPlayingItem.Name}
            </>
          )}
        </Link>

        {session.jellyseerrUser && (
          <div className="card-field">
            <Link
              href={`/users/${session.jellyseerrUser.id}`}
              className="group flex items-center"
            >
              <span className="avatar-sm">
                <CachedImage
                  type="avatar"
                  src={session.jellyseerrUser.avatar}
                  alt=""
                  className="avatar-sm object-cover"
                  width={20}
                  height={20}
                />
              </span>
              <span className="truncate font-semibold group-hover:text-white group-hover:underline">
                {session.jellyseerrUser.displayName}
              </span>
            </Link>
          </div>
        )}

        <div className="mt-6 hidden text-xs font-medium text-white sm:flex">
          <span>
            {session.PlayState.IsPaused
              ? intl.formatMessage(messages.statusPaused)
              : intl.formatMessage(messages.statusPlaying)}
          </span>
          <span className="mx-2">-</span>
          <span>
            {formatDuration(currentPosition)} / {formatDuration(durationSeconds)}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-600 mt-2">
          <div
            className={`h-full transition-all duration-200 ease-in-out ${
              session.PlayState.IsPaused ? 'bg-yellow-600' : 'bg-indigo-600'
            }`}
            style={{ width: `${(currentPosition / durationSeconds) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default withProperties(JellyfinSessionCard, {
  Placeholder: JellyfinSessionCardPlaceholder,
});
