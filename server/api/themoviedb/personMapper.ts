import ExternalAPI from '@server/api/externalapi';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import MetadataArtist from '@server/entity/MetadataArtist';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import EventEmitter from 'events';
import type { TmdbPersonResult, TmdbSearchPersonResponse } from './interfaces';

interface SearchPersonOptions {
  query: string;
  page?: number;
  includeAdult?: boolean;
  language?: string;
}

class TmdbPersonMapper extends ExternalAPI {
  private static instance: TmdbPersonMapper;
  private fetchingIds: Set<string> = new Set();
  private pendingFetches: Map<
    string,
    Promise<{ personId: number | null; profilePath: string | null }>
  > = new Map();
  private eventEmitter = new EventEmitter();
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

  public async getMappingFromCache(
    artistId: string
  ): Promise<
    { personId: number | null; profilePath: string | null } | undefined
  > {
    const metadataArtistRepository = getRepository(MetadataArtist);
    const metadata = await metadataArtistRepository.findOne({
      where: { mbArtistId: artistId },
    });

    if (metadata) {
      return {
        personId: metadata.tmdbPersonId ? Number(metadata.tmdbPersonId) : null,
        profilePath: metadata.tmdbThumb,
      };
    }
    return undefined;
  }

  public async getMapping(
    artistId: string,
    artistName: string,
    background = false
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    const metadataArtistRepository = getRepository(MetadataArtist);
    const metadata = await metadataArtistRepository.findOne({
      where: { mbArtistId: artistId },
    });

    if (metadata?.tmdbPersonId || metadata?.tmdbThumb) {
      return {
        personId: metadata.tmdbPersonId ? Number(metadata.tmdbPersonId) : null,
        profilePath: metadata.tmdbThumb,
      };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (metadata && metadata.updatedAt > thirtyDaysAgo) {
      return { personId: null, profilePath: null };
    }

    if (this.pendingFetches.has(artistId)) {
      const pendingFetch = this.pendingFetches.get(artistId);
      if (pendingFetch) {
        return await pendingFetch;
      }
      throw new Error(`Pending fetch for id ${artistId} not found`);
    }

    const fetchPromise = this.fetchMapping(artistId, artistName).then(
      (result) => {
        this.pendingFetches.delete(artistId);
        return result;
      }
    );
    this.pendingFetches.set(artistId, fetchPromise);

    if (background) {
      const timeoutPromise = new Promise<{
        personId: number | null;
        profilePath: string | null;
      }>((resolve) => {
        setTimeout(() => resolve({ personId: null, profilePath: null }), 100);
      });

      return Promise.race([fetchPromise, timeoutPromise]);
    }

    return fetchPromise;
  }

  private async fetchMapping(
    artistId: string,
    artistName: string
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    if (this.fetchingIds.has(artistId)) {
      return { personId: null, profilePath: null };
    }

    try {
      this.fetchingIds.add(artistId);
      const metadataArtistRepository = getRepository(MetadataArtist);

      const cleanArtistName = artistName
        .split(/(?:feat\.?|ft\.?|&|,)/i)[0]
        .trim()
        .replace(/['']/g, "'");

      const searchResults = await this.searchPerson({
        query: cleanArtistName,
        language: 'en',
      });

      const exactMatch = searchResults.results.find(
        (person: TmdbPersonResult) => {
          const normalizedPersonName = person.name
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['']/g, "'")
            .replace(/[^a-z0-9]/g, '')
            .trim();

          const normalizedArtistName = cleanArtistName
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['']/g, "'")
            .replace(/[^a-z0-9]/g, '')
            .trim();

          return normalizedPersonName === normalizedArtistName;
        }
      );

      const mapping = {
        personId: exactMatch?.id ?? null,
        profilePath: exactMatch?.profile_path
          ? `https://image.tmdb.org/t/p/w500${exactMatch.profile_path}`
          : null,
      };

      await metadataArtistRepository
        .upsert(
          {
            mbArtistId: artistId,
            tmdbPersonId: mapping.personId?.toString() ?? null,
            tmdbThumb: mapping.profilePath,
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
            error: e.message,
          });
        });

      return mapping;
    } catch (e) {
      const metadataArtistRepository = getRepository(MetadataArtist);
      await metadataArtistRepository.upsert(
        {
          mbArtistId: artistId,
          tmdbPersonId: null,
          tmdbThumb: null,
        },
        {
          conflictPaths: ['mbArtistId'],
        }
      );
      return { personId: null, profilePath: null };
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
      const data = await this.get<TmdbSearchPersonResponse>('/search/person', {
        query: options.query,
        page: options.page?.toString() ?? '1',
        include_adult: options.includeAdult ? 'true' : 'false',
        language: options.language ?? 'en',
      });

      return data;
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
