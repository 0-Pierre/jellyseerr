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
  private fetchingIds: Set<string> = new Set();
  private pendingFetches: Map<
    string,
    Promise<{ artistThumb: string | null; artistBackground: string | null }>
  > = new Map();
  private eventEmitter = new EventEmitter();

  constructor() {
    super(
      'https://www.theaudiodb.com/api/v1/json',
      {},
      {
        nodeCache: cacheManager.getCache('tadb').data,
        rateLimit: {
          maxRPS: 10,
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

  public async getArtistImagesFromCache(id: string): Promise<
    | {
        artistThumb: string | null;
        artistBackground: string | null;
      }
    | null
    | undefined
  > {
    const metadataArtistRepository = getRepository(MetadataArtist);
    const metadata = await metadataArtistRepository.findOne({
      where: { mbArtistId: id },
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
    const metadataArtistRepository = getRepository(MetadataArtist);
    const metadata = await metadataArtistRepository.findOne({
      where: { mbArtistId: id },
    });

    if (metadata?.tadbThumb || metadata?.tadbCover) {
      return {
        artistThumb: metadata.tadbThumb,
        artistBackground: metadata.tadbCover,
      };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (metadata && metadata.updatedAt > thirtyDaysAgo) {
      return { artistThumb: null, artistBackground: null };
    }

    if (this.pendingFetches.has(id)) {
      const pendingFetch = this.pendingFetches.get(id);
      if (pendingFetch) {
        return await pendingFetch;
      }
      throw new Error(`Pending fetch for id ${id} not found`);
    }

    const fetchPromise = this.fetchArtistImages(id).then((result) => {
      this.pendingFetches.delete(id);
      return result;
    });
    this.pendingFetches.set(id, fetchPromise);

    if (background) {
      const timeoutPromise = new Promise<{
        artistThumb: string | null;
        artistBackground: string | null;
      }>((resolve) => {
        setTimeout(() => {
          resolve({ artistThumb: null, artistBackground: null });
        }, 10);
      });

      return Promise.race([fetchPromise, timeoutPromise]);
    }

    return fetchPromise;
  }

  private async fetchArtistImages(id: string): Promise<{
    artistThumb: string | null;
    artistBackground: string | null;
  }> {
    if (this.fetchingIds.has(id)) {
      return { artistThumb: null, artistBackground: null };
    }

    try {
      this.fetchingIds.add(id);
      const metadataArtistRepository = getRepository(MetadataArtist);

      const data = await this.get<TadbArtistResponse>(
        `/${this.apiKey}/artist-mb.php`,
        { i: id },
        43200
      );

      const result = {
        artistThumb: data.artists?.[0]?.strArtistThumb || null,
        artistBackground: data.artists?.[0]?.strArtistFanart || null,
      };

      await metadataArtistRepository
        .upsert(
          {
            mbArtistId: id,
            tadbThumb: result.artistThumb,
            tadbCover: result.artistBackground,
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
            error: e.message,
          });
        });

      return result;
    } catch (e) {
      const metadataArtistRepository = getRepository(MetadataArtist);
      await metadataArtistRepository.upsert(
        {
          mbArtistId: id,
          tadbThumb: null,
          tadbCover: null,
        },
        {
          conflictPaths: ['mbArtistId'],
        }
      );
      return { artistThumb: null, artistBackground: null };
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
    return () => {
      this.eventEmitter.removeListener('artistImagesFound', callback);
    };
  }
}

export default TheAudioDb;
