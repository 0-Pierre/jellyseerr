import CoverArtArchive from '@server/api/coverartarchive';
import ListenBrainzAPI from '@server/api/listenbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MetadataArtist from '@server/entity/MetadataArtist';
import logger from '@server/logger';
import {
  mapCastCredits,
  mapCrewCredits,
  mapPersonDetails,
} from '@server/models/Person';
import { Router } from 'express';

const personRoutes = Router();

personRoutes.get('/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const listenbrainz = new ListenBrainzAPI();
  const theAudioDb = TheAudioDb.getInstance();
  const coverArtArchive = CoverArtArchive.getInstance();

  const typeOrder = [
    'Album',
    'EP',
    'Single',
    'Live',
    'Compilation',
    'Remix',
    'Soundtrack',
    'Broadcast',
    'Demo',
    'Other',
  ];

  try {
    const person = await tmdb.getPerson({
      personId: Number(req.params.id),
      language: (req.query.language as string) ?? req.locale,
    });

    const existingMetadata = await getRepository(MetadataArtist).findOne({
      where: { tmdbPersonId: person.id.toString() },
      select: ['mbArtistId', 'tmdbThumb', 'tadbThumb', 'tadbCover'],
    });

    let artistData = null;

    if (existingMetadata?.mbArtistId) {
      const artistResult = await listenbrainz.getArtist(
        existingMetadata.mbArtistId
      );
      artistData = artistResult;

      if (!existingMetadata.tadbThumb && !existingMetadata.tadbCover) {
        theAudioDb
          .getArtistImages(existingMetadata.mbArtistId, true)
          .catch(() => {
            // Silent fail for background task
          });
      }

      if (artistData?.releaseGroups) {
        const sortedReleaseGroups = [...artistData.releaseGroups].sort(
          (a, b) => {
            const typeIndexA = typeOrder.indexOf(a.type || 'Other');
            const typeIndexB = typeOrder.indexOf(b.type || 'Other');
            if (typeIndexA !== typeIndexB) return typeIndexA - typeIndexB;

            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateB - dateA;
          }
        );

        const allReleaseGroupIds = sortedReleaseGroups.map((rg) => rg.mbid);
        const [relatedMedia, cachedCovers] = await Promise.all([
          Media.getRelatedMedia(req.user, allReleaseGroupIds),
          Promise.all(
            allReleaseGroupIds.map((id) =>
              coverArtArchive.getCoverArtFromCache(id)
            )
          ),
        ]);

        const transformedReleaseGroups = sortedReleaseGroups.map(
          (releaseGroup, index) => {
            const cachedCoverArt = cachedCovers[index];

            if (!cachedCoverArt) {
              coverArtArchive.getCoverArt(releaseGroup.mbid, true);
            }

            return {
              id: releaseGroup.mbid,
              mediaType: 'album',
              title: releaseGroup.name,
              'first-release-date': releaseGroup.date,
              'artist-credit': [{ name: releaseGroup.artist_credit_name }],
              'primary-type': releaseGroup.type || 'Other',
              secondary_types: releaseGroup.secondary_types || [],
              total_listen_count: releaseGroup.total_listen_count || 0,
              posterPath: cachedCoverArt ?? undefined,
              mediaInfo: relatedMedia.find(
                (media) => media.mbId === releaseGroup.mbid
              ),
            };
          }
        );

        artistData = {
          ...artistData,
          releaseGroups: transformedReleaseGroups,
        };
      }
    }

    const mappedDetails = {
      ...mapPersonDetails(person),
      artist:
        artistData && existingMetadata?.mbArtistId
          ? {
              mbid: existingMetadata.mbArtistId,
              profilePath: person.profile_path
                ? `https://image.tmdb.org/t/p/w500${person.profile_path}`
                : existingMetadata.tadbThumb ?? null,
              artistThumb: existingMetadata.tadbThumb ?? null,
              artistBackdrop: existingMetadata.tadbCover ?? null,
              ...artistData,
            }
          : null,
    };

    return res.status(200).json(mappedDetails);
  } catch (e) {
    logger.debug('Something went wrong retrieving person', {
      label: 'API',
      errorMessage: e.message,
      personId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve person.',
    });
  }
});

personRoutes.get('/:id/combined_credits', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const combinedCredits = await tmdb.getPersonCombinedCredits({
      personId: Number(req.params.id),
      language: (req.query.language as string) ?? req.locale,
    });

    const castMedia = await Media.getRelatedMedia(
      req.user,
      combinedCredits.cast.map((result) => result.id)
    );

    const crewMedia = await Media.getRelatedMedia(
      req.user,
      combinedCredits.crew.map((result) => result.id)
    );

    return res.status(200).json({
      cast: combinedCredits.cast
        .map((result) =>
          mapCastCredits(
            result,
            castMedia.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === result.media_type
            )
          )
        )
        .filter((item) => !item.adult),
      crew: combinedCredits.crew
        .map((result) =>
          mapCrewCredits(
            result,
            crewMedia.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === result.media_type
            )
          )
        )
        .filter((item) => !item.adult),
      id: combinedCredits.id,
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving combined credits', {
      label: 'API',
      errorMessage: e.message,
      personId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve combined credits.',
    });
  }
});

export default personRoutes;
