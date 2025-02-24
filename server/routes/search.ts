import CoverArtArchive from '@server/api/coverartarchive';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import TheMovieDb from '@server/api/themoviedb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
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
  const page = Number(req.query.page) || 1;
  const language = (req.query.language as string) ?? req.locale;

  try {
    const searchProvider = findSearchProvider(queryString.toLowerCase());
    let results: CombinedSearchResponse;

    if (searchProvider) {
      const [id] = queryString
        .toLowerCase()
        .match(searchProvider.pattern) as RegExpMatchArray;
      results = await searchProvider.search({
        id,
        language,
        query: queryString,
      });
    } else {
      const tmdb = new TheMovieDb();
      const tmdbResultsPromise = tmdb.searchMulti({
        query: queryString,
        page,
        language,
      });

      const musicbrainz = new MusicBrainz();
      const coverArtArchive = CoverArtArchive.getInstance();
      const theAudioDb = TheAudioDb.getInstance();

      const [tmdbResults, [albumResults, artistResults]] = await Promise.all([
        tmdbResultsPromise,
        Promise.all([
          musicbrainz.searchAlbum({
            query: queryString,
            limit: ITEMS_PER_PAGE,
          }),
          musicbrainz.searchArtist({
            query: queryString,
            limit: ITEMS_PER_PAGE,
          }),
        ]),
      ]);

      const personsWithoutImages = tmdbResults.results.filter(
        (result) => result.media_type === 'person' && !result.profile_path
      );

      const personIds = personsWithoutImages.map((p) => p.id.toString());
      const artistMetadata =
        personIds.length > 0
          ? await getRepository(MetadataArtist).find({
              where: { tmdbPersonId: In(personIds) },
              cache: true,
            })
          : [];

      personsWithoutImages.forEach((person) => {
        const metadata = artistMetadata.find(
          (m) => m.tmdbPersonId === person.id.toString()
        );
        if (metadata?.tadbThumb) {
          Object.assign(person, {
            profile_path: metadata.tadbThumb,
            artist_backdrop: metadata.tadbCover,
          });
        }
      });

      const albumIds = albumResults.map((album) => album.id);
      const albumMetadata = await getRepository(MetadataAlbum).find({
        where: { mbAlbumId: In(albumIds) },
        cache: true,
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

      const artistIds = artistResults.map((artist) => artist.id);
      const artistsMetadata = await getRepository(MetadataArtist).find({
        where: { mbArtistId: In(artistIds) },
        cache: true,
      });

      const artistsWithArt = await Promise.all(
        artistResults.map(async (artist) => {
          const metadata = artistsMetadata.find(
            (m) => m.mbArtistId === artist.id
          );
          if (artist.type === 'Person' && !metadata?.tmdbPersonId) {
            try {
              const personMapper = TmdbPersonMapper.getInstance();
              await personMapper.getMapping(artist.id, artist.name);
              const updatedMetadata = await getRepository(
                MetadataArtist
              ).findOne({
                where: { mbArtistId: artist.id },
                cache: true,
              });
              if (updatedMetadata?.tmdbPersonId) return null;

              if (!updatedMetadata?.tadbThumb && !updatedMetadata?.tadbCover) {
                theAudioDb.getArtistImages(artist.id, true);
              }

              return {
                ...artist,
                media_type: 'artist' as const,
                artistThumb: updatedMetadata?.tadbThumb ?? null,
                artistBackdrop: updatedMetadata?.tadbCover ?? null,
                score: artist.score || 0,
              };
            } catch (error) {
              logger.error('Failed to get TMDB person mapping', {
                label: 'API',
                artistName: artist.name,
                error: error.message,
              });
            }
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

      const tmdbPersonResults = tmdbResults.results.filter(
        (result) => result.media_type === 'person'
      );

      const tmdbPersonIds = tmdbPersonResults.map((person) =>
        person.id.toString()
      );

      const existingMappings = await getRepository(MetadataArtist).find({
        where: { tmdbPersonId: In(tmdbPersonIds) },
        cache: true,
      });

      const filteredArtists = validArtists.filter((artist) => {
        const mapping = existingMappings.find(
          (mapping) => mapping.mbArtistId === artist.id
        );

        return !mapping || !tmdbPersonIds.includes(mapping.tmdbPersonId ?? '');
      });

      const musicResults = [...albumsWithArt, ...filteredArtists].sort(
        (a, b) => (b.score || 0) - (a.score || 0)
      );

      const totalItems = tmdbResults.total_results + musicResults.length;
      const totalPages = Math.max(
        tmdbResults.total_pages,
        Math.ceil(totalItems / ITEMS_PER_PAGE)
      );

      const combinedResults =
        page === 1
          ? [...tmdbResults.results, ...musicResults]
          : tmdbResults.results;

      results = {
        page: tmdbResults.page,
        total_pages: totalPages,
        total_results: totalItems,
        results: combinedResults,
      };
    }

    const media = await Promise.all([
      Media.getRelatedMedia(
        req.user,
        results.results
          .filter(
            (result) =>
              result.media_type === 'movie' || result.media_type === 'tv'
          )
          .map((result) => Number(result.id))
      ),
      Media.getRelatedMedia(
        req.user,
        results.results
          .filter(
            (result) =>
              result.media_type === 'album' || result.media_type === 'artist'
          )
          .map((result) => result.id.toString())
      ),
    ]).then(([movieTvMedia, musicMedia]) => [...movieTvMedia, ...musicMedia]);

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
      query: queryString,
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
