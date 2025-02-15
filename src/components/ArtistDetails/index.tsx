import Ellipsis from '@app/assets/ellipsis.svg';
import CachedImage from '@app/components/Common/CachedImage';
import ImageFader from '@app/components/Common/ImageFader';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import globalMessages from '@app/i18n/globalMessages';
import Error from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus } from '@server/constants/media';
import type { ArtistDetails as ArtistDetailsType } from '@server/models/Artist';
import { groupBy } from 'lodash';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import TruncateMarkup from 'react-truncate-markup';
import useSWR from 'swr';

const messages = defineMessages('components.ArtistDetails', {
  active: '{year} - Present',
  lifespan: '{beginYear} - {endYear}',
  discography: 'Discography',
  albums: 'Albums',
  singles: 'Singles',
  eps: 'EPs',
  other: 'Other Releases',
  alsoknownas: 'Also Known As: {names}',
});

const ArtistDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { data, error, mutate } = useSWR<ArtistDetailsType>(
    `/api/v1/artist/${router.query.artistId}`
  );
  const [showBio, setShowBio] = useState(false);

  useEffect(() => {
    const caaEventSource = new EventSource('/caaproxy/updates');

    const processCAAUpdate = (coverArtData: { id: string; url: string }) => {
      mutate((currentData?: ArtistDetailsType) => {
        if (!currentData) return currentData;

        return {
          ...currentData,
          releaseGroups: currentData.releaseGroups?.map((release) => {
            if (release.id === coverArtData.id) {
              return {
                ...release,
                posterPath: coverArtData.url,
              };
            }
            return release;
          }),
        };
      }, false);
    };

    caaEventSource.onmessage = (event) => {
      const coverArtData = JSON.parse(event.data);
      processCAAUpdate(coverArtData);
    };

    return () => {
      caaEventSource.close();
    };
  }, [mutate]);

  const groupedReleases = useMemo(() => {
    if (!data?.releaseGroups) {
      return null;
    }

    return groupBy(data.releaseGroups, 'primary-type');
  }, [data?.releaseGroups]);

  const renderReleaseGroup = (
    title: string,
    releases: ArtistDetailsType['releaseGroups']
  ) => {
    if (!releases?.length) {
      return null;
    }

    return (
      <>
        <div className="slider-header">
          <div className="slider-title">
            <span>{title}</span>
          </div>
        </div>
        <ul className="cards-vertical">
          {releases.map((media) => (
            <li key={`release-${media.id}`}>
              <TitleCard
                key={media.id}
                id={media.id}
                title={media.title}
                year={media['first-release-date']}
                image={media.posterPath}
                mediaType="album"
                artist={media['artist-credit']?.[0]?.name}
                type={media['primary-type']}
                status={
                  media.mediaInfo?.status
                    ? MediaStatus[
                        media.mediaInfo.status as keyof typeof MediaStatus
                      ]
                    : undefined
                }
                canExpand
              />
            </li>
          ))}
        </ul>
      </>
    );
  };

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <Error statusCode={404} />;
  }

  const artistAttributes: string[] = [];

  if (data.artist.begin_year) {
    const yearString = data.artist.end_year
      ? intl.formatMessage(messages.lifespan, {
          beginYear: data.artist.begin_year,
          endYear: data.artist.end_year,
        })
      : intl.formatMessage(messages.active, {
          year: data.artist.begin_year,
        });

    if (data.artist.area) {
      artistAttributes.push(`${yearString} | ${data.artist.area}`);
    } else {
      artistAttributes.push(yearString);
    }
  } else if (data.artist.area) {
    artistAttributes.push(data.artist.area);
  }

  return (
    <>
      <PageTitle title={data?.artist?.name ?? ''} />
      <div className="absolute top-0 left-0 right-0 z-0 h-96">
        <ImageFader
          isDarker
          backgroundImages={
            data.artistBackdrop
              ? [data.artistBackdrop]
              : (data.releaseGroups ?? [])
                  .filter((release) => release.posterPath)
                  .map((release) => release.posterPath)
                  .filter((path): path is string => !!path)
                  .slice(0, 6)
          }
        />
      </div>
      <div
        className={`relative z-10 mt-4 mb-8 flex flex-col items-center lg:flex-row ${
          data.biography ? 'lg:items-start' : ''
        }`}
      >
        {(data.artistThumb || data.profilePath) && (
          <div className="relative mb-6 mr-0 h-36 w-36 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-gray-700 lg:mb-0 lg:mr-6 lg:h-44 lg:w-44">
            <CachedImage
              type="music"
              src={data.artistThumb || data.profilePath || ''}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
          </div>
        )}
        <div className="text-center text-gray-300 lg:text-left">
          <h1 className="text-3xl text-white lg:text-4xl">{data.name}</h1>
          {artistAttributes.length > 0 && (
            <div className="mt-1 mb-2 space-y-1 text-xs text-white sm:text-sm lg:text-base">
              <div>{artistAttributes.join(' | ')}</div>
            </div>
          )}
          {(data.alsoKnownAs ?? []).length > 0 && (
            <div>
              {intl.formatMessage(messages.alsoknownas, {
                names: (data.alsoKnownAs ?? []).reduce((prev, curr) =>
                  intl.formatMessage(globalMessages.delimitedlist, {
                    a: prev,
                    b: curr,
                  })
                ),
              })}
            </div>
          )}
          {data.wikipedia?.content && (
            <div className="relative text-left">
              <button
                className="group w-full text-left outline-none ring-0"
                onClick={() => setShowBio((show) => !show)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Space') {
                    setShowBio((show) => !show);
                  }
                }}
              >
                <TruncateMarkup
                  lines={showBio ? 200 : 6}
                  ellipsis={
                    <Ellipsis className="relative -top-0.5 ml-2 inline-block opacity-70 transition duration-300 group-hover:opacity-100" />
                  }
                >
                  <p className="pt-2 text-sm lg:text-base">
                    {data.wikipedia.content}
                  </p>
                </TruncateMarkup>
              </button>
            </div>
          )}
        </div>
      </div>
      {groupedReleases && (
        <>
          {renderReleaseGroup(
            intl.formatMessage(messages.albums),
            groupedReleases['Album']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.singles),
            groupedReleases['Single']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.eps),
            groupedReleases['EP']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.other),
            groupedReleases['Other']
          )}
        </>
      )}
    </>
  );
};

export default ArtistDetails;
