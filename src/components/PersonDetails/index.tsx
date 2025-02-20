import Ellipsis from '@app/assets/ellipsis.svg';
import CachedImage from '@app/components/Common/CachedImage';
import ImageFader from '@app/components/Common/ImageFader';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import globalMessages from '@app/i18n/globalMessages';
import Error from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { PersonCombinedCreditsResponse } from '@server/interfaces/api/personInterfaces';
import type { PersonDetails as PersonDetailsType } from '@server/models/Person';
import { groupBy, orderBy } from 'lodash';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import TruncateMarkup from 'react-truncate-markup';
import useSWR from 'swr';

const messages = defineMessages('components.PersonDetails', {
  birthdate: 'Born {birthdate}',
  lifespan: '{birthdate} – {deathdate}',
  alsoknownas: 'Also Known As: {names}',
  appearsin: 'Appearances',
  crewmember: 'Crew',
  ascharacter: 'as {character}',
  album: 'Album',
  single: 'Single',
  ep: 'EP',
  live: 'Live',
  compilation: 'Compilation',
  remix: 'Remix',
  soundtrack: 'Soundtrack',
  broadcast: 'Broadcast',
  demo: 'Demo',
  other: 'Other',
});

const PersonDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { data, error, mutate } = useSWR<PersonDetailsType>(
    `/api/v1/person/${router.query.personId}`
  );
  const [showBio, setShowBio] = useState(false);

  const { data: combinedCredits, error: errorCombinedCredits } =
    useSWR<PersonCombinedCreditsResponse>(
      `/api/v1/person/${router.query.personId}/combined_credits`
    );

  useEffect(() => {
    const caaEventSource = new EventSource('/caaproxy/updates');
    const tadbEventSource = new EventSource('/tadbproxy/updates');

    const processCAAUpdate = (coverArtData: { id: string; url: string }) => {
      mutate((currentData) => {
        if (!currentData) return currentData;

        return {
          ...currentData,
          artist: {
            ...currentData.artist,
            releaseGroups: currentData.artist?.releaseGroups?.map((release) => {
              if (release.id === coverArtData.id) {
                return {
                  ...release,
                  posterPath: coverArtData.url,
                };
              }
              return release;
            }),
          },
        };
      }, false);
    };

    const processTADBUpdate = (tadbData: {
      id: string;
      urls: {
        artistThumb: string | null;
        artistBackground: string | null;
      };
    }) => {
      mutate((currentData) => {
        if (!currentData) return currentData;

        if (
          currentData.artist?.releaseGroups?.some(
            (group) => group['artist-credit']?.[0]?.name === currentData.name
          )
        ) {
          return {
            ...currentData,
            artistThumb: tadbData.urls.artistThumb,
            artistBackdrop: tadbData.urls.artistBackground,
          };
        }
        return currentData;
      }, false);
    };

    caaEventSource.onmessage = (event) => {
      const coverArtData = JSON.parse(event.data);
      processCAAUpdate(coverArtData);
    };

    tadbEventSource.onmessage = (event) => {
      const tadbData = JSON.parse(event.data);
      processTADBUpdate(tadbData);
    };

    return () => {
      caaEventSource.close();
      tadbEventSource.close();
    };
  }, [mutate]);

  const sortedCast = useMemo(() => {
    const grouped = groupBy(combinedCredits?.cast ?? [], 'id');

    const reduced = Object.values(grouped).map((objs) => ({
      ...objs[0],
      character: objs.map((pos) => pos.character).join(', '),
    }));

    return reduced.sort((a, b) => {
      const aVotes = a.voteCount ?? 0;
      const bVotes = b.voteCount ?? 0;
      if (aVotes > bVotes) {
        return -1;
      }
      return 1;
    });
  }, [combinedCredits]);

  const sortedCrew = useMemo(() => {
    const grouped = groupBy(combinedCredits?.crew ?? [], 'id');

    const reduced = Object.values(grouped).map((objs) => ({
      ...objs[0],
      job: objs.map((pos) => pos.job).join(', '),
    }));

    return reduced.sort((a, b) => {
      const aVotes = a.voteCount ?? 0;
      const bVotes = b.voteCount ?? 0;
      if (aVotes > bVotes) {
        return -1;
      }
      return 1;
    });
  }, [combinedCredits]);

  const groupedReleases = useMemo(() => {
    if (!data?.artist?.releaseGroups) {
      return null;
    }

    const grouped = groupBy(data.artist.releaseGroups, (release) => {
      if (release.secondary_types?.length) {
        return release.secondary_types[0];
      }
      return release['primary-type'] || 'Other';
    });

    return grouped;
  }, [data?.artist?.releaseGroups]);

  const renderReleaseGroup = (title: string, releases: any[]) => {
    if (!releases?.length) {
      return null;
    }

    const sortedReleases = orderBy(
      releases,
      [(r) => r['first-release-date'] || '', 'title'],
      ['desc', 'asc']
    );

    return (
      <>
        <div className="slider-header">
          <div className="slider-title">
            <span>{title}</span>
          </div>
        </div>
        <ul className="cards-vertical">
          {sortedReleases.map((media) => (
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
                status={media.mediaInfo?.status}
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

  const personAttributes: string[] = [];

  if (data.birthday) {
    if (data.deathday) {
      personAttributes.push(
        intl.formatMessage(messages.lifespan, {
          birthdate: intl.formatDate(data.birthday, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          }),
          deathdate: intl.formatDate(data.deathday, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          }),
        })
      );
    } else {
      personAttributes.push(
        intl.formatMessage(messages.birthdate, {
          birthdate: intl.formatDate(data.birthday, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          }),
        })
      );
    }
  }

  if (data.placeOfBirth) {
    personAttributes.push(data.placeOfBirth);
  }

  const isLoading = !combinedCredits && !errorCombinedCredits;

  const cast = (sortedCast ?? []).length > 0 && (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.appearsin)}</span>
        </div>
      </div>
      <ul className="cards-vertical">
        {sortedCast?.map((media, index) => {
          return (
            <li key={`list-cast-item-${media.id}-${index}`}>
              <TitleCard
                key={media.id}
                id={media.id}
                title={media.mediaType === 'movie' ? media.title : media.name}
                userScore={media.voteAverage}
                year={
                  media.mediaType === 'movie'
                    ? media.releaseDate
                    : media.firstAirDate
                }
                image={media.posterPath}
                summary={media.overview}
                mediaType={media.mediaType as 'movie' | 'tv'}
                status={media.mediaInfo?.status}
                canExpand
              />
              {media.character && (
                <div className="mt-2 w-full truncate text-center text-xs text-gray-300">
                  {intl.formatMessage(messages.ascharacter, {
                    character: media.character,
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );

  const crew = (sortedCrew ?? []).length > 0 && (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.crewmember)}</span>
        </div>
      </div>
      <ul className="cards-vertical">
        {sortedCrew?.map((media, index) => {
          return (
            <li key={`list-crew-item-${media.id}-${index}`}>
              <TitleCard
                key={media.id}
                id={media.id}
                title={media.mediaType === 'movie' ? media.title : media.name}
                userScore={media.voteAverage}
                year={
                  media.mediaType === 'movie'
                    ? media.releaseDate
                    : media.firstAirDate
                }
                image={media.posterPath}
                summary={media.overview}
                mediaType={media.mediaType as 'movie' | 'tv'}
                status={media.mediaInfo?.status}
                canExpand
              />
              {media.job && (
                <div className="mt-2 w-full truncate text-center text-xs text-gray-300">
                  {media.job}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );

  return (
    <>
      <PageTitle title={data.name} />
      {(sortedCrew || sortedCast) && (
        <div className="absolute top-0 left-0 right-0 z-0 h-96">
          <ImageFader
            isDarker
            backgroundImages={[...(sortedCast ?? []), ...(sortedCrew ?? [])]
              .filter((media) => media.backdropPath)
              .map(
                (media) =>
                  `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${media.backdropPath}`
              )
              .slice(0, 6)}
          />
        </div>
      )}
      <div
        className={`relative z-10 mt-4 mb-8 flex flex-col items-center lg:flex-row ${
          data.biography ? 'lg:items-start' : ''
        }`}
      >
        {(data.profilePath || data.artist?.artistThumb) && (
          <div className="relative mb-6 mr-0 h-36 w-36 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-gray-700 lg:mb-0 lg:mr-6 lg:h-44 lg:w-44">
            <CachedImage
              type={data.profilePath ? 'tmdb' : 'music'}
              src={
                data.profilePath
                  ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${data.profilePath}`
                  : data.artist?.artistThumb ?? ''
              }
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
          </div>
        )}
        <div className="text-center text-gray-300 lg:text-left">
          <h1 className="text-3xl text-white lg:text-4xl">{data.name}</h1>
          <div className="mt-1 mb-2 space-y-1 text-xs text-white sm:text-sm lg:text-base">
            <div>{personAttributes.join(' | ')}</div>
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
          </div>
          {data.biography && (
            <div className="relative text-left">
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
              <div
                className="group outline-none ring-0"
                onClick={() => setShowBio((show) => !show)}
                role="button"
                tabIndex={-1}
              >
                <TruncateMarkup
                  lines={showBio ? 200 : 6}
                  ellipsis={
                    <Ellipsis className="relative -top-0.5 ml-2 inline-block opacity-70 transition duration-300 group-hover:opacity-100" />
                  }
                >
                  <p className="pt-2 text-sm lg:text-base">{data.biography}</p>
                </TruncateMarkup>
              </div>
            </div>
          )}
        </div>
      </div>
      {groupedReleases && (
        <>
          {renderReleaseGroup(
            intl.formatMessage(messages.album),
            groupedReleases['Album']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.ep),
            groupedReleases['EP']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.single),
            groupedReleases['Single']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.live),
            groupedReleases['Live']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.compilation),
            groupedReleases['Compilation']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.remix),
            groupedReleases['Remix']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.soundtrack),
            groupedReleases['Soundtrack']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.broadcast),
            groupedReleases['Broadcast']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.demo),
            groupedReleases['Demo']
          )}
          {renderReleaseGroup(
            intl.formatMessage(messages.other),
            groupedReleases['Other']
          )}
        </>
      )}
      {data.knownForDepartment === 'Acting' ? [cast, crew] : [crew, cast]}
      {isLoading && <LoadingSpinner />}
    </>
  );
};

export default PersonDetails;
