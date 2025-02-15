import TheAudioDb from '@server/api/theaudiodb';
import ImageProxy from '@server/lib/imageproxy';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();
const tadbImageProxy = new ImageProxy('tadb', 'https://r2.theaudiodb.com', {
  rateLimitOptions: {
    maxRPS: 10,
  },
});

router.get('/updates', (req, res) => {
  const theAudioDb = TheAudioDb.getInstance();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (data: {
    id: string;
    urls: {
      artistThumb: string | null;
      artistBackground: string | null;
    };
  }) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribe = theAudioDb.onArtistImagesFound(listener);

  req.on('close', () => {
    unsubscribe();
  });
});

router.get('/*', async (req, res) => {
  const imagePath = req.path;
  try {
    const imageData = await tadbImageProxy.getImage(imagePath);

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
