import CoverArtArchive from '@server/api/coverartarchive';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import MetadataArtist from '@server/entity/MetadataArtist';
import {
  findSearchProvider,
  type CombinedSearchResponse,
} from '@server/lib/search';
import logger from '@server/logger';
import { mapSearchResults } from '@server/models/Search';
import { Router } from 'express';
import { In } from 'typeorm';

const searchRoutes = Router();

const ITEMS_PER_PAGE = 20;
searchRoutes.get('/', async (req, res, next) => {
  const queryString = req.query.query as string;
  const searchProvider = findSearchProvider(queryString.toLowerCase());
  let results: CombinedSearchResponse;
  let combinedResults: CombinedSearchResponse['results'] = [];

  try {
    if (searchProvider) {
      const [id] = queryString
        .toLowerCase()
        .match(searchProvider.pattern) as RegExpMatchArray;
      results = await searchProvider.search({
        id,
        language: (req.query.language as string) ?? req.locale,
        query: queryString,
      });
    } else {
      const tmdb = new TheMovieDb();
      const tmdbResults = await tmdb.searchMulti({
        query: queryString,
        page: Number(req.query.page),
      });

      const personsWithoutImages = tmdbResults.results.filter(
        (result) => result.media_type === 'person' && !result.profile_path
      );

      if (personsWithoutImages.length > 0) {
        const metadataArtistRepository = getRepository(MetadataArtist);
        const personIds = personsWithoutImages.map((p) => p.id.toString());

        const artistMetadata = await metadataArtistRepository.find({
          where: { tmdbPersonId: In(personIds) },
        });

        for (const person of personsWithoutImages) {
          const metadata = artistMetadata.find(
            (m) => m.tmdbPersonId === person.id.toString()
          );
          if (metadata?.tadbThumb) {
            Object.assign(person, {
              profile_path: metadata.tadbThumb,
              artist_backdrop: metadata.tadbCover,
            });
          }
        }
      }

      combinedResults = [...tmdbResults.results];

      const musicbrainz = new MusicBrainz();
      const coverArtArchive = CoverArtArchive.getInstance();
      const theAudioDb = TheAudioDb.getInstance();

      const [albumResults, artistResults] = await Promise.all([
        musicbrainz.searchAlbum({
          query: queryString,
          limit: 20,
        }),
        musicbrainz.searchArtist({
          query: queryString,
          limit: 20,
        }),
      ]);

      const metadataAlbumRepository = getRepository(MetadataAlbum);
      const albumIds = albumResults.map((album) => album.id);
      const albumMetadata = await metadataAlbumRepository.find({
        where: { mbAlbumId: In(albumIds) },
      });

      const albumsWithArt = albumResults.map((album) => {
        const metadata = albumMetadata.find((m) => m.mbAlbumId === album.id);

        if (!metadata?.caaUrl) {
          coverArtArchive.getCoverArt(album.id, true);
        }

        return {
          ...album,
          media_type: 'album' as const,
          posterPath: metadata?.caaUrl ?? undefined,
          score: album.score || 0,
        };
      });

      const metadataArtistRepository = getRepository(MetadataArtist);
      const artistIds = artistResults.map((artist) => artist.id);
      const artistMetadata = await metadataArtistRepository.find({
        where: { mbArtistId: In(artistIds) },
      });

      const artistsWithArt = await Promise.all(
        artistResults.map(async (artist) => {
          const metadata = artistMetadata.find(
            (m) => m.mbArtistId === artist.id
          );

          if (metadata?.tmdbPersonId) {
            return null;
          }

          if (!metadata?.tadbThumb && !metadata?.tadbCover) {
            theAudioDb.getArtistImages(artist.id, true);
          }

          return {
            ...artist,
            media_type: 'artist' as const,
            artistThumb: metadata?.tadbThumb ?? null,
            artistBackdrop: metadata?.tadbCover ?? null,
            score: artist.score || 0,
          };
        })
      );

      const validArtists = artistsWithArt.filter(
        (artist): artist is NonNullable<typeof artist> => artist !== null
      );

      const musicResults = [...albumsWithArt, ...validArtists].sort((a, b) => {
        return (b.score || 0) - (a.score || 0);
      });

      const totalItems = tmdbResults.total_results + musicResults.length;
      const totalPages = Math.max(
        tmdbResults.total_pages,
        Math.ceil(totalItems / ITEMS_PER_PAGE)
      );

      if (Number(req.query.page) === 1) {
        combinedResults = [...tmdbResults.results, ...musicResults];
      } else {
        combinedResults = [...tmdbResults.results];
      }

      results = {
        page: tmdbResults.page,
        total_pages: totalPages,
        total_results: totalItems,
        results: combinedResults,
      };
    }

    const media = await Media.getRelatedMedia(
      req.user,
      results.results.map((result) => {
        return result.id.toString();
      })
    );

    const mappedResults = await mapSearchResults(results.results, media);

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results,
      results: mappedResults,
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving search results', {
      label: 'API',
      errorMessage: e.message,
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve search results.',
    });
  }
});

searchRoutes.get('/keyword', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.searchKeyword({
      query: req.query.query as string,
      page: Number(req.query.page),
    });

    return res.status(200).json(results);
  } catch (e) {
    logger.debug('Something went wrong retrieving keyword search results', {
      label: 'API',
      errorMessage: e.message,
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve keyword search results.',
    });
  }
});

searchRoutes.get('/company', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.searchCompany({
      query: req.query.query as string,
      page: Number(req.query.page),
    });

    return res.status(200).json(results);
  } catch (e) {
    logger.debug('Something went wrong retrieving company search results', {
      label: 'API',
      errorMessage: e.message,
      query: req.query.query,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve company search results.',
    });
  }
});

export default searchRoutes;
