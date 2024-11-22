import JellyfinSessionCard from '@app/components/JellyfinSessionCard';
import Slider from '@app/components/Slider';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import defineMessages from '@app/utils/defineMessages';

const messages = defineMessages('components.Discover.JellyfinSessionsSlider', {
  jellyfinsessions: 'Active Sessions',
  emptysessions: 'No active playback sessions found.',
});

interface JellyfinSession {
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
  };
  PlayState: {
    PositionTicks: number;
    IsPaused: boolean;
  };
}

const JellyfinSessionsSlider = () => {
  const intl = useIntl();
  const { data: sessions, error } = useSWR<JellyfinSession[]>(
    '/api/v1/jellyfin/sessions',
    {
      refreshInterval: 1000,
    }
  );

  const isLoading = !sessions && !error;
  const isEmpty = sessions?.length === 0;

  return (
    <>
      <div className="slider-header">
        <Link href="/jellyfin/sessions" className="slider-title">
          <span>{intl.formatMessage(messages.jellyfinsessions)}</span>
        </Link>
      </div>
      <Slider
        sliderKey="jellyfin-sessions"
        isLoading={isLoading}
        isEmpty={isEmpty}
        emptyMessage={intl.formatMessage(messages.emptysessions)}
        items={sessions?.map((session) => (
          <JellyfinSessionCard
            key={`session-${session.Id}`}
            session={session}
          />
        ))}
        placeholder={<JellyfinSessionCard.Placeholder />}
      />
    </>
  );
};

export default JellyfinSessionsSlider;
