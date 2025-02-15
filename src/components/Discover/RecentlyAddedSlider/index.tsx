import AddedCard from '@app/components/AddedCard';
import Slider from '@app/components/Slider';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.RecentlyAddedSlider', {
  recentlyAdded: 'Recently Added',
});

const RecentlyAddedSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { data: media, error: mediaError } = useSWR<MediaResultsResponse>(
    '/api/v1/media?filter=allavailable&take=20&sort=mediaAdded',
    { revalidateOnMount: true }
  );

  const [mediaItems, setMediaItems] = useState(media?.results ?? []);

  useEffect(() => {
    setMediaItems(media?.results ?? []);
  }, [media]);

  useEffect(() => {
    const caaEventSource = new EventSource('/caaproxy/updates');

    const processCAAUpdate = (coverArtData: { id: string; url: string }) => {
      setMediaItems((currentItems) =>
        currentItems.map((item) => {
          if (item.mediaType === 'music' && item.mbId === coverArtData.id) {
            return Object.assign(Object.create(Object.getPrototypeOf(item)), {
              ...item,
              posterPath: coverArtData.url,
            });
          }
          return item;
        })
      );
    };

    caaEventSource.onmessage = (event) => {
      const coverArtData = JSON.parse(event.data);
      processCAAUpdate(coverArtData);
    };

    return () => {
      caaEventSource.close();
    };
  }, []);

  if (
    (media && !media.results.length && !mediaError) ||
    !hasPermission([Permission.MANAGE_REQUESTS, Permission.RECENT_VIEW], {
      type: 'or',
    })
  ) {
    return null;
  }

  return (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.recentlyAdded)}</span>
        </div>
      </div>
      <Slider
        sliderKey="media"
        isLoading={!media}
        items={mediaItems.map((item) => (
          <AddedCard
            key={`media-slider-item-${item.id}`}
            id={item.id}
            tmdbId={item.tmdbId}
            tvdbId={item.tvdbId}
            mbId={item.mbId}
            type={item.mediaType}
          />
        ))}
      />
    </>
  );
};

export default RecentlyAddedSlider;
