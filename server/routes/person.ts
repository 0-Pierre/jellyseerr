import CoverArtArchive from '@server/api/coverartarchive';
import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import TheMovieDb from '@server/api/themoviedb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import Media from '@server/entity/Media';
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
  const musicbrainz = new MusicBrainz();
  const listenbrainz = new ListenBrainzAPI();
  const personMapper = TmdbPersonMapper.getInstance();
  const theAudioDb = TheAudioDb.getInstance();
  const coverArtArchive = CoverArtArchive.getInstance();

  try {
    const person = await tmdb.getPerson({
      personId: Number(req.params.id),
      language: (req.query.language as string) ?? req.locale,
    });

    let artistId: string | null = null;
    let artistData = null;

    try {
      const mbArtists = await musicbrainz.searchArtist({
        query: person.name,
        limit: 1,
      });

      if (mbArtists.length > 0) {
        const artist = mbArtists[0];
        const nameMatches =
          artist.name.toLowerCase() === person.name.toLowerCase() ||
          artist.aliases?.some(
            (alias) => alias.name.toLowerCase() === person.name.toLowerCase()
          );

        if (nameMatches && artist.type === 'Person') {
          artistId = artist.id;
          const mapping =
            (await personMapper.getMappingFromCache(artistId)) ||
            (await personMapper.getMapping(artistId, person.name, false));

          if (mapping?.personId && mapping.personId !== person.id) {
            artistId = null;
          }
        }
      }
    } catch (error) {
      logger.error('Failed to search MusicBrainz artist', {
        label: 'Person API',
        personName: person.name,
        error: error.message,
      });
    }

    if (artistId) {
      try {
        const [artistResult, cachedTheAudioDb] = await Promise.all([
          listenbrainz.getArtist(artistId),
          theAudioDb.getArtistImagesFromCache(artistId),
        ]);

        artistData = artistResult;

        if (!cachedTheAudioDb) {
          theAudioDb.getArtistImages(artistId, true);
        }

        if (artistData?.releaseGroups) {
          const sortedReleaseGroups = [...artistData.releaseGroups].sort(
            (a, b) => {
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
      } catch (error) {
        logger.error('Failed to fetch artist data', {
          label: 'Person API',
          artistId,
          error: error.message,
        });
      }
    }

    const mappedDetails = {
      ...mapPersonDetails(person),
      artist:
        artistData && artistId
          ? {
              mbid: artistId,
              profilePath: person.profile_path
                ? `https://image.tmdb.org/t/p/w500${person.profile_path}`
                : (await theAudioDb.getArtistImagesFromCache(artistId))
                    ?.artistThumb ?? null,
              artistThumb:
                (await theAudioDb.getArtistImagesFromCache(artistId))
                  ?.artistThumb ?? null,
              artistBackdrop:
                (await theAudioDb.getArtistImagesFromCache(artistId))
                  ?.artistBackground ?? null,
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
