import CoverArtArchive from '@server/api/coverartarchive';
import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import MetadataArtist from '@server/entity/MetadataArtist';
import logger from '@server/logger';
import { Router } from 'express';
import { In } from 'typeorm';

const artistRoutes = Router();

artistRoutes.get('/:id', async (req, res, next) => {
  const listenbrainz = new ListenBrainzAPI();
  const musicbrainz = new MusicBrainz();
  const coverArtArchive = CoverArtArchive.getInstance();
  const theAudioDb = TheAudioDb.getInstance();

  try {
    const [metadataArtist, artistData, cachedTheAudioDb] = await Promise.all([
      getRepository(MetadataArtist).findOne({
        where: { mbArtistId: req.params.id },
      }),
      listenbrainz.getArtist(req.params.id),
      theAudioDb.getArtistImagesFromCache(req.params.id),
    ]);

    if (!artistData) {
      throw new Error('Artist not found');
    }

    if (!metadataArtist?.tadbThumb && !metadataArtist?.tadbCover) {
      theAudioDb.getArtistImages(req.params.id, true).catch(() => {
        // Silent fail for background task
      });
    }

    const [artistWikipedia, relatedMedia, albumMetadata] = await Promise.all([
      musicbrainz
        .getArtistWikipediaExtract({
          artistMbid: req.params.id,
          language: req.locale,
        })
        .catch(() => null),
      Media.getRelatedMedia(
        req.user,
        artistData.releaseGroups.map((rg) => rg.mbid)
      ),
      getRepository(MetadataAlbum).find({
        where: { mbAlbumId: In(artistData.releaseGroups.map((rg) => rg.mbid)) },
      }),
    ]);

    const sortedReleaseGroups = artistData.releaseGroups
      .map((releaseGroup) => {
        const metadata = albumMetadata.find(
          (m) => m.mbAlbumId === releaseGroup.mbid
        );

        if (!metadata?.caaUrl) {
          coverArtArchive.getCoverArt(releaseGroup.mbid, true).catch(() => {
            // Silent fail for background task
          });
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
          posterPath: metadata?.caaUrl ?? null,
          mediaInfo: relatedMedia.find(
            (media) => media.mbId === releaseGroup.mbid
          ),
        };
      })
      .sort((a, b) => {
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
        const typeIndexA = typeOrder.indexOf(a['primary-type']);
        const typeIndexB = typeOrder.indexOf(b['primary-type']);

        if (typeIndexA !== typeIndexB) {
          return typeIndexA - typeIndexB;
        }

        const dateA = a['first-release-date']
          ? new Date(a['first-release-date']).getTime()
          : 0;
        const dateB = b['first-release-date']
          ? new Date(b['first-release-date']).getTime()
          : 0;

        return dateB - dateA;
      });

    return res.status(200).json({
      ...artistData,
      wikipedia: artistWikipedia,
      artistThumb:
        metadataArtist?.tmdbThumb ??
        metadataArtist?.tadbThumb ??
        cachedTheAudioDb?.artistThumb ??
        null,
      artistBackdrop:
        metadataArtist?.tadbCover ?? cachedTheAudioDb?.artistBackground ?? null,
      releaseGroups: sortedReleaseGroups,
    });
  } catch (e) {
    logger.error('Something went wrong retrieving artist details', {
      label: 'Artist API',
      errorMessage: e.message,
      artistId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve artist.',
    });
  }
});

export default artistRoutes;
