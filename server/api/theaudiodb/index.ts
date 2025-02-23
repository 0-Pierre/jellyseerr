import ExternalAPI from '@server/api/externalapi';
import { getRepository } from '@server/datasource';
import MetadataArtist from '@server/entity/MetadataArtist';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import EventEmitter from 'events';
import type { TadbArtistResponse } from './interfaces';

class TheAudioDb extends ExternalAPI {
  private static instance: TheAudioDb;
  private readonly apiKey = '195003';
  private readonly fetchingIds: Set<string> = new Set();
  private readonly pendingFetches: Map<
    string,
    Promise<{ artistThumb: string | null; artistBackground: string | null }>
  > = new Map();
  private readonly eventEmitter = new EventEmitter();
  private readonly CACHE_TTL = 43200;
  private readonly BACKGROUND_TIMEOUT = 250;
  private readonly STALE_THRESHOLD = 30 * 24 * 60 * 60 * 1000;

  constructor() {
    super(
      'https://www.theaudiodb.com/api/v1/json',
      {},
      {
        nodeCache: cacheManager.getCache('tadb').data,
        rateLimit: {
          maxRPS: 25,
          id: 'tadb',
        },
      }
    );
  }

  public static getInstance(): TheAudioDb {
    if (!TheAudioDb.instance) {
      TheAudioDb.instance = new TheAudioDb();
    }
    return TheAudioDb.instance;
  }

  private isMetadataStale(metadata: MetadataArtist | null): boolean {
    if (!metadata || !metadata.tadbUpdatedAt) return true;
    return Date.now() - metadata.tadbUpdatedAt.getTime() > this.STALE_THRESHOLD;
  }

  private createEmptyResponse() {
    return { artistThumb: null, artistBackground: null };
  }

  public async getArtistImagesFromCache(id: string): Promise<
    | {
        artistThumb: string | null;
        artistBackground: string | null;
      }
    | null
    | undefined
  > {
    const metadata = await getRepository(MetadataArtist).findOne({
      where: { mbArtistId: id },
      select: ['tadbThumb', 'tadbCover', 'tadbUpdatedAt'],
    });

    if (metadata) {
      return {
        artistThumb: metadata.tadbThumb,
        artistBackground: metadata.tadbCover,
      };
    }
    return undefined;
  }

  public async getArtistImages(
    id: string,
    background = false
  ): Promise<{ artistThumb: string | null; artistBackground: string | null }> {
    try {
      const metadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: id },
        select: ['tadbThumb', 'tadbCover', 'tadbUpdatedAt'],
      });

      if (metadata?.tadbThumb || metadata?.tadbCover) {
        return {
          artistThumb: metadata.tadbThumb,
          artistBackground: metadata.tadbCover,
        };
      }

      if (metadata && !this.isMetadataStale(metadata)) {
        return this.createEmptyResponse();
      }

      if (this.pendingFetches.has(id)) {
        const pendingFetch = this.pendingFetches.get(id);
        if (!pendingFetch) {
          throw new Error(`Pending fetch for id ${id} not found`);
        }

        if (background) {
          const timeoutPromise = new Promise<{
            artistThumb: string | null;
            artistBackground: string | null;
          }>((resolve) =>
            setTimeout(
              () => resolve(this.createEmptyResponse()),
              this.BACKGROUND_TIMEOUT
            )
          );
          return Promise.race([pendingFetch, timeoutPromise]);
        }
        return pendingFetch;
      }

      const fetchPromise = this.fetchArtistImages(id).finally(() =>
        this.pendingFetches.delete(id)
      );
      this.pendingFetches.set(id, fetchPromise);

      if (background) {
        const timeoutPromise = new Promise<{
          artistThumb: string | null;
          artistBackground: string | null;
        }>((resolve) =>
          setTimeout(
            () => resolve(this.createEmptyResponse()),
            this.BACKGROUND_TIMEOUT
          )
        );
        return Promise.race([fetchPromise, timeoutPromise]);
      }
      return fetchPromise;
    } catch (error) {
      logger.error('Failed to get artist images', {
        label: 'TheAudioDb',
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createEmptyResponse();
    }
  }

  private async fetchArtistImages(id: string): Promise<{
    artistThumb: string | null;
    artistBackground: string | null;
  }> {
    if (this.fetchingIds.has(id)) {
      return this.createEmptyResponse();
    }

    this.fetchingIds.add(id);
    try {
      const data = await this.get<TadbArtistResponse>(
        `/${this.apiKey}/artist-mb.php`,
        { i: id },
        this.CACHE_TTL
      );

      const result = {
        artistThumb: data.artists?.[0]?.strArtistThumb || null,
        artistBackground: data.artists?.[0]?.strArtistFanart || null,
      };

      const metadataRepository = getRepository(MetadataArtist);
      await metadataRepository
        .upsert(
          {
            mbArtistId: id,
            tadbThumb: result.artistThumb,
            tadbCover: result.artistBackground,
            tadbUpdatedAt: new Date(),
          },
          {
            conflictPaths: ['mbArtistId'],
          }
        )
        .then(() => {
          if (result.artistThumb || result.artistBackground) {
            this.eventEmitter.emit('artistImagesFound', { id, urls: result });
          }
        })
        .catch((e) => {
          logger.error('Failed to save artist metadata', {
            label: 'TheAudioDb',
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        });

      return result;
    } catch (error) {
      await getRepository(MetadataArtist).upsert(
        {
          mbArtistId: id,
          tadbThumb: null,
          tadbCover: null,
          tadbUpdatedAt: new Date(),
        },
        {
          conflictPaths: ['mbArtistId'],
        }
      );
      return this.createEmptyResponse();
    } finally {
      this.fetchingIds.delete(id);
    }
  }

  public onArtistImagesFound(
    callback: (data: {
      id: string;
      urls: { artistThumb: string | null; artistBackground: string | null };
    }) => void
  ): () => void {
    this.eventEmitter.on('artistImagesFound', callback);
    return () =>
      this.eventEmitter.removeListener('artistImagesFound', callback);
  }
}

export default TheAudioDb;
