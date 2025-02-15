import ExternalAPI from '@server/api/externalapi';
import { getRepository } from '@server/datasource';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import EventEmitter from 'events';
import type { CoverArtResponse } from './interfaces';

class CoverArtArchive extends ExternalAPI {
  private static instance: CoverArtArchive;
  private fetchingIds: Set<string> = new Set();
  private pendingFetches: Map<string, Promise<CoverArtResponse>> = new Map();
  private eventEmitter = new EventEmitter();

  public static getInstance(): CoverArtArchive {
    if (!CoverArtArchive.instance) {
      CoverArtArchive.instance = new CoverArtArchive();
    }
    return CoverArtArchive.instance;
  }

  private constructor() {
    super(
      'https://coverartarchive.org',
      {},
      {
        nodeCache: cacheManager.getCache('covertartarchive').data,
        rateLimit: {
          maxRPS: 100,
          id: 'covertartarchive',
        },
      }
    );
  }

  public async getCoverArtFromCache(
    id: string
  ): Promise<string | null | undefined> {
    const metadataAlbumRepository = getRepository(MetadataAlbum);
    const metadata = await metadataAlbumRepository.findOne({
      where: { mbAlbumId: id },
    });

    return metadata?.caaUrl;
  }

  public async getCoverArt(
    id: string,
    background = false
  ): Promise<CoverArtResponse> {
    const metadataAlbumRepository = getRepository(MetadataAlbum);
    const metadata = await metadataAlbumRepository.findOne({
      where: { mbAlbumId: id },
    });

    if (metadata?.caaUrl) {
      return {
        images: [
          {
            approved: true,
            front: true,
            id: 0,
            thumbnails: { 250: metadata.caaUrl },
          },
        ],
        release: `/release/${id}`,
      };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (metadata && metadata.updatedAt > thirtyDaysAgo) {
      return { images: [], release: `/release/${id}` };
    }

    if (this.pendingFetches.has(id)) {
      const pendingFetch = this.pendingFetches.get(id);
      if (pendingFetch) {
        return await pendingFetch;
      }
      throw new Error(`Pending fetch for id ${id} not found`);
    }

    const fetchPromise = this.fetchCoverArt(id).then((result) => {
      this.pendingFetches.delete(id);
      return result;
    });
    this.pendingFetches.set(id, fetchPromise);

    if (background) {
      const timeoutPromise = new Promise<CoverArtResponse>((resolve) => {
        setTimeout(() => {
          resolve({ images: [], release: `/release/${id}` });
        }, 10);
      });

      return Promise.race([fetchPromise, timeoutPromise]);
    }

    return fetchPromise;
  }

  private async fetchCoverArt(id: string): Promise<CoverArtResponse> {
    if (this.fetchingIds.has(id)) {
      return { images: [], release: `/release/${id}` };
    }

    try {
      this.fetchingIds.add(id);
      const metadataAlbumRepository = getRepository(MetadataAlbum);

      const data = await this.get<CoverArtResponse>(
        `/release-group/${id}`,
        undefined,
        43200
      );

      const releaseMBID = data.release.split('/').pop();

      data.images = data.images.map((image) => {
        const baseUrl = `/mbid-${releaseMBID}/mbid-${releaseMBID}-${image.id}_thumb250.jpg`;

        const fullUrl = `https://archive.org/download${baseUrl}`;

        if (image.front) {
          metadataAlbumRepository
            .upsert(
              {
                mbAlbumId: id,
                caaUrl: fullUrl,
              },
              {
                conflictPaths: ['mbAlbumId'],
              }
            )
            .then(() => {
              this.eventEmitter.emit('coverArtFound', { id, url: fullUrl });
            })
            .catch((e) => {
              logger.error('Failed to save album metadata', {
                label: 'CoverArtArchive',
                error: e.message,
              });
            });
        }

        return {
          approved: image.approved,
          front: image.front,
          id: image.id,
          thumbnails: { 250: fullUrl },
        };
      });

      return data;
    } catch (e) {
      const metadataAlbumRepository = getRepository(MetadataAlbum);
      await metadataAlbumRepository.upsert(
        {
          mbAlbumId: id,
          caaUrl: null,
        },
        {
          conflictPaths: ['mbAlbumId'],
        }
      );
      return { images: [], release: `/release/${id}` };
    } finally {
      this.fetchingIds.delete(id);
    }
  }

  public onCoverArtFound(
    callback: (data: { id: string; url: string }) => void
  ): () => void {
    this.eventEmitter.on('coverArtFound', callback);
    return () => {
      this.eventEmitter.removeListener('coverArtFound', callback);
    };
  }
}

export default CoverArtArchive;
