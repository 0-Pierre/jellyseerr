import { Router } from 'express';
import { getRepository } from '@server/datasource';
import { In } from 'typeorm';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import JellyfinAPI from '@server/api/jellyfin';
import logger from '@server/logger';
import { getHostname } from '@server/utils/getHostname';

const router = Router();

router.get('/sessions', async (req, res) => {
  try {
    const settings = getSettings();
    const userRepository = getRepository(User);

    const admin = await userRepository.findOneOrFail({
      select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
      where: { id: 1 },
      order: { id: 'ASC' },
    });

    const jellyfinClient = new JellyfinAPI(
      getHostname(),
      settings.jellyfin.apiKey,
      admin.jellyfinDeviceId ?? ''
    );

    const jellyfinSessions = await jellyfinClient.getActiveSessions();

    const jellyseerrUsers = await userRepository.find({
      select: ['id', 'jellyfinUserId', 'jellyfinUsername', 'username', 'avatar'],
      where: {
        jellyfinUserId: In(jellyfinSessions.map(session => session.UserId))
      }
    });

    const mappedSessions = jellyfinSessions
      .map(session => {
        const jellyseerrUser = jellyseerrUsers.find(
          user => user.jellyfinUserId === session.UserId
        );
        return {
          ...session,
          jellyseerrUser: jellyseerrUser ? {
            ...jellyseerrUser,
            displayName: jellyseerrUser.username || jellyseerrUser.jellyfinUsername
          } : undefined
        };
      })
      .sort((a, b) => {
        return b.PlayState.PositionTicks - a.PlayState.PositionTicks;
      });

    return res.status(200).json(mappedSessions);
  } catch (error) {
    logger.error('Failed to fetch Jellyfin sessions', {
      label: 'Jellyfin Sessions',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;
