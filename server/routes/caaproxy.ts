import CoverArtArchive from '@server/api/coverartarchive';
import ImageProxy from '@server/lib/imageproxy';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();
const caaImageProxy = new ImageProxy('caa', 'https://archive.org/download', {
  rateLimitOptions: {
    maxRPS: 50,
  },
});

router.get('/updates', (req, res) => {
  const coverArtArchive = CoverArtArchive.getInstance();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (data: { id: string; url: string }) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribe = coverArtArchive.onCoverArtFound(listener);

  req.on('close', () => {
    unsubscribe();
  });
});

/**
 * Image Proxy
 */
router.get('/*', async (req, res) => {
  const imagePath = req.path.replace('/download', '');
  try {
    const imageData = await caaImageProxy.getImage(imagePath);

    res.writeHead(200, {
      'Content-Type': `image/${imageData.meta.extension}`,
      'Content-Length': imageData.imageBuffer.length,
      'Cache-Control': `public, max-age=${imageData.meta.curRevalidate}`,
      'OS-Cache-Key': imageData.meta.cacheKey,
      'OS-Cache-Status': imageData.meta.cacheMiss ? 'MISS' : 'HIT',
    });

    res.end(imageData.imageBuffer);
  } catch (e) {
    logger.error('Failed to proxy image', {
      imagePath,
      errorMessage: e.message,
    });
    res.status(500).send();
  }
});

export default router;
