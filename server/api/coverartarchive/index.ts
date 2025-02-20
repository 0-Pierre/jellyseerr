import ExternalAPI from '@server/api/externalapi';
import { getRepository } from '@server/datasource';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import EventEmitter from 'events';
import type { CoverArtResponse } from './interfaces';

class CoverArtArchive extends ExternalAPI {
  private static instance: CoverArtArchive;
  private readonly fetchingIds: Set<string> = new Set();
  private readonly pendingFetches: Map<string, Promise<CoverArtResponse>> =
    new Map();
  private readonly eventEmitter = new EventEmitter();
  private readonly CACHE_TTL = 43200;
  private readonly BACKGROUND_TIMEOUT = 250;
  private readonly STALE_THRESHOLD = 30 * 24 * 60 * 60 * 1000;

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

  private isMetadataStale(metadata: MetadataAlbum | null): boolean {
    if (!metadata) return true;
    return Date.now() - metadata.updatedAt.getTime() > this.STALE_THRESHOLD;
  }

  private createEmptyResponse(id: string): CoverArtResponse {
    return { images: [], release: `/release/${id}` };
  }

  private createCachedResponse(url: string, id: string): CoverArtResponse {
    return {
      images: [
        {
          approved: true,
          front: true,
          id: 0,
          thumbnails: { 250: url },
        },
      ],
      release: `/release/${id}`,
    };
  }

  public async getCoverArtFromCache(
    id: string
  ): Promise<string | null | undefined> {
    const metadata = await getRepository(MetadataAlbum).findOne({
      where: { mbAlbumId: id },
      select: ['caaUrl'],
    });
    return metadata?.caaUrl;
  }

  public async getCoverArt(
    id: string,
    background = false
  ): Promise<CoverArtResponse> {
    try {
      const metadata = await getRepository(MetadataAlbum).findOne({
        where: { mbAlbumId: id },
        select: ['caaUrl', 'updatedAt'],
      });

      if (metadata?.caaUrl) {
        return this.createCachedResponse(metadata.caaUrl, id);
      }

      if (metadata && !this.isMetadataStale(metadata)) {
        return this.createEmptyResponse(id);
      }

      if (this.pendingFetches.has(id)) {
        const pendingFetch = this.pendingFetches.get(id);
        if (!pendingFetch) {
          throw new Error(`Invalid pending fetch for id ${id}`);
        }
        return background
          ? Promise.race([
              pendingFetch,
              new Promise<CoverArtResponse>((resolve) =>
                setTimeout(
                  () => resolve(this.createEmptyResponse(id)),
                  this.BACKGROUND_TIMEOUT
                )
              ),
            ])
          : pendingFetch;
      }

      const fetchPromise = this.fetchCoverArt(id).finally(() =>
        this.pendingFetches.delete(id)
      );
      this.pendingFetches.set(id, fetchPromise);

      return background
        ? Promise.race([
            fetchPromise,
            new Promise<CoverArtResponse>((resolve) =>
              setTimeout(
                () => resolve(this.createEmptyResponse(id)),
                this.BACKGROUND_TIMEOUT
              )
            ),
          ])
        : fetchPromise;
    } catch (error) {
      logger.error('Failed to get cover art', {
        label: 'CoverArtArchive',
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createEmptyResponse(id);
    }
  }

  private async fetchCoverArt(id: string): Promise<CoverArtResponse> {
    if (this.fetchingIds.has(id)) {
      return this.createEmptyResponse(id);
    }

    this.fetchingIds.add(id);
    try {
      const data = await this.get<CoverArtResponse>(
        `/release-group/${id}`,
        undefined,
        this.CACHE_TTL
      );

      const releaseMBID = data.release.split('/').pop();
      const metadataRepository = getRepository(MetadataAlbum);

      data.images = data.images.map((image) => {
        const fullUrl = `https://archive.org/download/mbid-${releaseMBID}/mbid-${releaseMBID}-${image.id}_thumb250.jpg`;

        if (image.front) {
          metadataRepository
            .upsert(
              { mbAlbumId: id, caaUrl: fullUrl },
              { conflictPaths: ['mbAlbumId'] }
            )
            .then(() =>
              this.eventEmitter.emit('coverArtFound', { id, url: fullUrl })
            )
            .catch((e) => {
              logger.error('Failed to save album metadata', {
                label: 'CoverArtArchive',
                error: e instanceof Error ? e.message : 'Unknown error',
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
    } catch (error) {
      await getRepository(MetadataAlbum).upsert(
        { mbAlbumId: id, caaUrl: null },
        { conflictPaths: ['mbAlbumId'] }
      );
      return this.createEmptyResponse(id);
    } finally {
      this.fetchingIds.delete(id);
    }
  }

  public onCoverArtFound(
    callback: (data: { id: string; url: string }) => void
  ): () => void {
    this.eventEmitter.on('coverArtFound', callback);
    return () => this.eventEmitter.removeListener('coverArtFound', callback);
  }
}

export default CoverArtArchive;
