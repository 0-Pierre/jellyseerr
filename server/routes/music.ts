import CoverArtArchive from '@server/api/coverartarchive';
import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import MetadataArtist from '@server/entity/MetadataArtist';
import { Watchlist } from '@server/entity/Watchlist';
import logger from '@server/logger';
import { mapMusicDetails } from '@server/models/Music';
import { Router } from 'express';
import { In } from 'typeorm';

const musicRoutes = Router();

musicRoutes.get('/:id', async (req, res, next) => {
  const listenbrainz = new ListenBrainzAPI();
  const musicbrainz = new MusicBrainz();
  const coverArtArchive = CoverArtArchive.getInstance();
  const personMapper = TmdbPersonMapper.getInstance();

  try {
    const [albumDetails, media, onUserWatchlist] = await Promise.all([
      listenbrainz.getAlbum(req.params.id),
      getRepository(Media)
        .createQueryBuilder('media')
        .leftJoinAndSelect('media.requests', 'requests')
        .leftJoinAndSelect('requests.requestedBy', 'requestedBy')
        .leftJoinAndSelect('requests.modifiedBy', 'modifiedBy')
        .where({
          mbId: req.params.id,
          mediaType: MediaType.MUSIC,
        })
        .getOne()
        .then((media) => media ?? undefined),
      getRepository(Watchlist).exist({
        where: {
          mbId: req.params.id,
          requestedBy: { id: req.user?.id },
        },
      }),
    ]);

    const artistId =
      albumDetails.release_group_metadata?.artist?.artists[0]?.artist_mbid;

    const metadataAlbum = await getRepository(MetadataAlbum).findOne({
      where: { mbAlbumId: req.params.id },
    });
    let metadataArtist = artistId
      ? await getRepository(MetadataArtist).findOne({
          where: { mbArtistId: artistId },
        })
      : undefined;

    if (!metadataAlbum?.caaUrl) {
      coverArtArchive.getCoverArt(req.params.id, true);
    }

    if (artistId && !metadataArtist?.tadbThumb && !metadataArtist?.tadbCover) {
      TheAudioDb.getInstance().getArtistImages(artistId, true);
    }

    if (
      artistId &&
      !metadataArtist?.tmdbPersonId &&
      albumDetails.release_group_metadata?.artist?.artists[0]?.type === 'Person'
    ) {
      try {
        await personMapper.getMapping(
          artistId,
          albumDetails.release_group_metadata.artist.artists[0].name
        );
        metadataArtist = await getRepository(MetadataArtist).findOne({
          where: { mbArtistId: artistId },
        });
      } catch (error) {
        logger.error('Failed to get TMDB person mapping', {
          label: 'Music API',
          artistName:
            albumDetails.release_group_metadata.artist.artists[0].name,
          error: error.message,
        });
      }
    }

    const trackArtistIds = albumDetails.mediums
      .flatMap((medium) => medium.tracks)
      .flatMap((track) => track.artists)
      .filter((artist) => artist.artist_mbid)
      .map((artist) => artist.artist_mbid);

    let trackArtistMetadata = await getRepository(MetadataArtist).find({
      where: { mbArtistId: In(trackArtistIds) },
    });

    const trackArtistPromises = albumDetails.mediums.flatMap((medium) =>
      medium.tracks.flatMap((track) =>
        track.artists
          .filter((artist) => artist.artist_mbid)
          .filter(
            (artist) =>
              !trackArtistMetadata.some(
                (m) => m.mbArtistId === artist.artist_mbid
              )
          )
          .map((artist) =>
            personMapper
              .getMapping(artist.artist_mbid, artist.artist_credit_name)
              .catch((error) => {
                logger.error('Failed to get TMDB person mapping for artist', {
                  label: 'Music API',
                  artistName: artist.artist_credit_name,
                  artistMbid: artist.artist_mbid,
                  error: error.message,
                });
              })
          )
      )
    );

    await Promise.all(trackArtistPromises);

    trackArtistMetadata = await getRepository(MetadataArtist).find({
      where: { mbArtistId: In(trackArtistIds) },
    });

    const mappedDetails = mapMusicDetails(albumDetails, media, onUserWatchlist);

    const artistWikipedia = artistId
      ? await musicbrainz
          .getArtistWikipediaExtract({
            artistMbid: artistId,
            language: req.locale,
          })
          .catch((error) => {
            if (
              !error.message.includes('No Wikipedia extract found') &&
              !error.message.includes('fetch failed')
            ) {
              logger.error('Failed to fetch Wikipedia extract', {
                label: 'Music API',
                errorMessage: error.message,
                artistMbid: artistId,
              });
            }
            return null;
          })
      : null;

    return res.status(200).json({
      ...mappedDetails,
      posterPath: metadataAlbum?.caaUrl ?? null,
      artistWikipedia,
      artistThumb:
        metadataArtist?.tmdbThumb ?? metadataArtist?.tadbThumb ?? null,
      artistBackdrop: metadataArtist?.tadbCover ?? null,
      tmdbPersonId: metadataArtist?.tmdbPersonId
        ? Number(metadataArtist.tmdbPersonId)
        : null,
      tracks: mappedDetails.tracks.map((track) => ({
        ...track,
        artists: track.artists.map((artist) => ({
          ...artist,
          tmdbMapping: trackArtistMetadata.find(
            (m) => m.mbArtistId === artist.mbid
          )
            ? {
                personId: Number(
                  trackArtistMetadata.find((m) => m.mbArtistId === artist.mbid)
                    ?.tmdbPersonId
                ),
                profilePath: trackArtistMetadata.find(
                  (m) => m.mbArtistId === artist.mbid
                )?.tmdbThumb,
              }
            : null,
        })),
      })),
    });
  } catch (e) {
    logger.error('Something went wrong retrieving album details', {
      label: 'Music API',
      errorMessage: e.message,
      mbId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve album details.',
    });
  }
});

musicRoutes.get('/:id/artist', async (req, res, next) => {
  try {
    const listenbrainzApi = new ListenBrainzAPI();
    const coverArtArchive = CoverArtArchive.getInstance();
    const personMapper = TmdbPersonMapper.getInstance();
    const theAudioDb = TheAudioDb.getInstance();
    const metadataAlbumRepository = getRepository(MetadataAlbum);
    const metadataArtistRepository = getRepository(MetadataArtist);

    const albumData = await listenbrainzApi.getAlbum(req.params.id);
    const artistId =
      albumData?.release_group_metadata?.artist?.artists?.[0]?.artist_mbid;
    if (!artistId) {
      throw new Error('No artist ID found in album metadata');
    }

    const [artistData, cachedTheAudioDb] = await Promise.all([
      listenbrainzApi.getArtist(artistId),
      theAudioDb.getArtistImagesFromCache(artistId),
    ]);

    if (!artistData) {
      return res.status(404).json({ status: 404, message: 'Artist not found' });
    }

    if (!cachedTheAudioDb) {
      theAudioDb.getArtistImages(artistId, true);
    }

    const [relatedMedia, albumMetadata] = await Promise.all([
      Media.getRelatedMedia(
        req.user,
        artistData.releaseGroups.map((rg) => rg.mbid)
      ),
      metadataAlbumRepository.find({
        where: { mbAlbumId: In(artistData.releaseGroups.map((rg) => rg.mbid)) },
      }),
    ]);

    const transformedReleaseGroups = artistData.releaseGroups.map(
      (releaseGroup) => {
        const metadata = albumMetadata.find(
          (m) => m.mbAlbumId === releaseGroup.mbid
        );

        if (!metadata?.caaUrl) {
          coverArtArchive.getCoverArt(releaseGroup.mbid, true);
        }

        return {
          id: releaseGroup.mbid,
          mediaType: 'album',
          title: releaseGroup.name,
          'first-release-date': releaseGroup.date,
          'artist-credit': [{ name: releaseGroup.artist_credit_name }],
          'primary-type': releaseGroup.type || 'Other',
          posterPath: metadata?.caaUrl ?? null,
          mediaInfo: relatedMedia.find(
            (media) => media.mbId === releaseGroup.mbid
          ),
        };
      }
    );

    const similarArtistIds =
      artistData.similarArtists?.artists?.map((a) => a.artist_mbid) ?? [];
    const similarArtistMetadata =
      similarArtistIds.length > 0
        ? await metadataArtistRepository.find({
            where: { mbArtistId: In(similarArtistIds) },
          })
        : [];

    const transformedSimilarArtists = artistData.similarArtists?.artists
      ? await Promise.all(
          artistData.similarArtists.artists.map(async (artist) => {
            const metadata = similarArtistMetadata.find(
              (m) => m.mbArtistId === artist.artist_mbid
            );

            if (!metadata?.tadbThumb && !metadata?.tadbCover) {
              theAudioDb.getArtistImages(artist.artist_mbid, true);
            }

            let updatedMetadata = metadata;
            if (artist.type === 'Person' && !metadata?.tmdbPersonId) {
              try {
                await personMapper.getMapping(artist.artist_mbid, artist.name);
                updatedMetadata =
                  (await metadataArtistRepository.findOne({
                    where: { mbArtistId: artist.artist_mbid },
                  })) ?? undefined;
              } catch (error) {
                logger.error('Failed to get TMDB person mapping', {
                  label: 'Music API',
                  artistName: artist.name,
                  error: error.message,
                });
              }
            }

            return {
              ...artist,
              artistThumb:
                updatedMetadata?.tmdbThumb ??
                updatedMetadata?.tadbThumb ??
                null,
              artistBackground: updatedMetadata?.tadbCover ?? null,
              tmdbPersonId: updatedMetadata?.tmdbPersonId
                ? Number(updatedMetadata.tmdbPersonId)
                : null,
            };
          })
        )
      : [];

    return res.status(200).json({
      artist: {
        ...artistData,
        artistThumb: cachedTheAudioDb?.artistThumb ?? null,
        artistBackdrop: cachedTheAudioDb?.artistBackground ?? null,
        similarArtists: {
          ...artistData.similarArtists,
          artists: transformedSimilarArtists,
        },
        releaseGroups: transformedReleaseGroups,
      },
    });
  } catch (error) {
    logger.error('Something went wrong retrieving artist details', {
      label: 'Music API',
      errorMessage: error.message,
      artistId: req.params.id,
    });
    return next({ status: 500, message: 'Unable to retrieve artist details.' });
  }
});

export default musicRoutes;
