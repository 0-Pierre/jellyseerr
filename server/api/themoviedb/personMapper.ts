import ExternalAPI from '@server/api/externalapi';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import MetadataArtist from '@server/entity/MetadataArtist';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import EventEmitter from 'events';
import type { TmdbSearchPersonResponse } from './interfaces';

interface SearchPersonOptions {
  query: string;
  page?: number;
  includeAdult?: boolean;
  language?: string;
}

class TmdbPersonMapper extends ExternalAPI {
  private static instance: TmdbPersonMapper;
  private readonly fetchingIds: Set<string> = new Set();
  private readonly pendingFetches: Map<
    string,
    Promise<{ personId: number | null; profilePath: string | null }>
  > = new Map();
  private readonly eventEmitter = new EventEmitter();
  private readonly CACHE_TTL = 43200;
  private readonly BACKGROUND_TIMEOUT = 250;
  private readonly STALE_THRESHOLD = 30 * 24 * 60 * 60 * 1000;
  private tmdb: TheMovieDb;

  private constructor() {
    super(
      'https://api.themoviedb.org/3',
      {
        api_key: '431a8708161bcd1f1fbe7536137e61ed',
      },
      {
        nodeCache: cacheManager.getCache('tmdb').data,
        rateLimit: {
          maxRPS: 50,
          id: 'tmdb',
        },
      }
    );
    this.tmdb = new TheMovieDb();
  }

  public static getInstance(): TmdbPersonMapper {
    if (!TmdbPersonMapper.instance) {
      TmdbPersonMapper.instance = new TmdbPersonMapper();
    }
    return TmdbPersonMapper.instance;
  }

  private isMetadataStale(metadata: MetadataArtist | null): boolean {
    if (!metadata || !metadata.tmdbUpdatedAt) return true;
    return Date.now() - metadata.tmdbUpdatedAt.getTime() > this.STALE_THRESHOLD;
  }

  private createEmptyResponse() {
    return { personId: null, profilePath: null };
  }

  public async getMapping(
    artistId: string,
    artistName: string,
    background = false
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    try {
      const metadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: artistId },
        select: ['tmdbPersonId', 'tmdbThumb', 'tmdbUpdatedAt'],
      });

      if (metadata?.tmdbPersonId || metadata?.tmdbThumb) {
        return {
          personId: metadata.tmdbPersonId
            ? Number(metadata.tmdbPersonId)
            : null,
          profilePath: metadata.tmdbThumb,
        };
      }

      if (metadata && !this.isMetadataStale(metadata)) {
        return this.createEmptyResponse();
      }

      if (this.pendingFetches.has(artistId)) {
        const pendingFetch = this.pendingFetches.get(artistId);
        if (!pendingFetch) {
          throw new Error(`Pending fetch for id ${artistId} not found`);
        }

        if (background) {
          return Promise.race([
            pendingFetch,
            new Promise<{
              personId: number | null;
              profilePath: string | null;
            }>((resolve) =>
              setTimeout(
                () => resolve(this.createEmptyResponse()),
                this.BACKGROUND_TIMEOUT
              )
            ),
          ]);
        }
        return pendingFetch;
      }

      const fetchPromise = this.fetchMapping(artistId, artistName).finally(() =>
        this.pendingFetches.delete(artistId)
      );
      this.pendingFetches.set(artistId, fetchPromise);

      if (background) {
        return Promise.race([
          fetchPromise,
          new Promise<{ personId: number | null; profilePath: string | null }>(
            (resolve) =>
              setTimeout(
                () => resolve(this.createEmptyResponse()),
                this.BACKGROUND_TIMEOUT
              )
          ),
        ]);
      }
      return fetchPromise;
    } catch (error) {
      logger.error('Failed to get person mapping', {
        label: 'TmdbPersonMapper',
        artistId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createEmptyResponse();
    }
  }

  public async getMappingFromCache(
    artistId: string
  ): Promise<{ personId: number | null; profilePath: string | null } | null> {
    try {
      const metadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: artistId },
        select: ['tmdbPersonId', 'tmdbThumb', 'tmdbUpdatedAt'],
      });

      if (!metadata) {
        return null;
      }

      if (this.isMetadataStale(metadata)) {
        return null;
      }

      return {
        personId: metadata.tmdbPersonId ? Number(metadata.tmdbPersonId) : null,
        profilePath: metadata.tmdbThumb,
      };
    } catch (error) {
      logger.error('Failed to get person mapping from cache', {
        label: 'TmdbPersonMapper',
        artistId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private async fetchMapping(
    artistId: string,
    artistName: string
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    if (this.fetchingIds.has(artistId)) {
      return this.createEmptyResponse();
    }

    this.fetchingIds.add(artistId);
    try {
      const cleanArtistName = artistName
        .split(/(?:(?:feat|ft)\.?\s+|&\s*|,\s+)/i)[0]
        .trim()
        .replace(/['']/g, "'");

      const searchResults = await this.get<TmdbSearchPersonResponse>(
        '/search/person',
        {
          query: cleanArtistName,
          page: '1',
          include_adult: 'false',
          language: 'en',
        },
        this.CACHE_TTL
      );

      const exactMatches = searchResults.results.filter((person) => {
        const normalizedPersonName = person.name
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/['']/g, "'")
          .replace(/[^a-z0-9\s]/g, '')
          .trim();

        const normalizedArtistName = cleanArtistName
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/['']/g, "'")
          .replace(/[^a-z0-9\s]/g, '')
          .trim();

        return normalizedPersonName === normalizedArtistName;
      });

      const soundMatches = exactMatches.filter(
        (person) => person.known_for_department === 'Sound'
      );

      const exactMatch =
        soundMatches.length > 0
          ? soundMatches.reduce((prev, current) =>
              current.popularity > prev.popularity ? current : prev
            )
          : exactMatches.length > 0
          ? exactMatches.reduce((prev, current) =>
              current.popularity > prev.popularity ? current : prev
            )
          : null;

      const mapping = {
        personId: exactMatch?.id ?? null,
        profilePath: exactMatch?.profile_path
          ? `https://image.tmdb.org/t/p/w500${exactMatch.profile_path}`
          : null,
      };

      await getRepository(MetadataArtist)
        .upsert(
          {
            mbArtistId: artistId,
            tmdbPersonId: mapping.personId?.toString() ?? null,
            tmdbThumb: mapping.profilePath,
            tmdbUpdatedAt: new Date(),
          },
          {
            conflictPaths: ['mbArtistId'],
          }
        )
        .then(() => {
          if (mapping.personId) {
            this.eventEmitter.emit('mappingFound', { artistId, mapping });
          }
        })
        .catch((e) => {
          logger.error('Failed to save artist metadata', {
            label: 'TmdbPersonMapper',
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        });

      return mapping;
    } catch (error) {
      await getRepository(MetadataArtist).upsert(
        {
          mbArtistId: artistId,
          tmdbPersonId: null,
          tmdbThumb: null,
          tmdbUpdatedAt: new Date(),
        },
        {
          conflictPaths: ['mbArtistId'],
        }
      );
      return this.createEmptyResponse();
    } finally {
      this.fetchingIds.delete(artistId);
    }
  }

  public onMappingFound(
    callback: (data: {
      artistId: string;
      mapping: { personId: number | null; profilePath: string | null };
    }) => void
  ): () => void {
    this.eventEmitter.on('mappingFound', callback);
    return () => this.eventEmitter.removeListener('mappingFound', callback);
  }

  public async searchPerson(
    options: SearchPersonOptions
  ): Promise<TmdbSearchPersonResponse> {
    try {
      return await this.get<TmdbSearchPersonResponse>(
        '/search/person',
        {
          query: options.query,
          page: options.page?.toString() ?? '1',
          include_adult: options.includeAdult ? 'true' : 'false',
          language: options.language ?? 'en',
        },
        this.CACHE_TTL
      );
    } catch (e) {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  }
}

export default TmdbPersonMapper;
