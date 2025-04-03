import JellyfinAPI from '@server/api/jellyfin';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import notificationManager, { Notification } from '@server/lib/notifications';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getHostname } from '@server/utils/getHostname';

const subscriptionsSync = {
  async run() {
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);

      const users = await userRepository.find({
        where: { subscriptionStatus: 'active' },
      });

      const now = new Date();
      const oneWeekFromNow = new Date();
      oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

      const hostname = getHostname();
      const jellyfinClient = new JellyfinAPI(
        hostname,
        settings.jellyfin.apiKey
      );

      for (const user of users) {
        if (
          user.subscriptionExpirationDate &&
          new Date(user.subscriptionExpirationDate) < now
        ) {
          const oldStatus = user.subscriptionStatus;

          user.subscriptionStatus = 'expired';
          user.permissions = 740343936;
          user.notifiedAboutExpiration = false;

          if (user.jellyfinUserId) {
            try {
              await jellyfinClient.updateUserPolicy(user.jellyfinUserId, {
                IsAdministrator: false,
                IsDisabled: false,
                EnableUserPreferenceAccess: true,
                EnableLiveTvAccess: false,
                EnableLiveTvManagement: false,
                EnableRemoteAccess: true,
                EnableMediaPlayback: false,
                EnableVideoPlayback: false,
                EnableAudioPlayback: false,
                EnableMediaConversion: false,
                EnableVideoPlaybackTranscoding: false,
                EnableAudioPlaybackTranscoding: false,
                EnablePlaybackRemuxing: false,
                EnableContentDownloading: false,
                AuthenticationProviderId:
                  'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
                PasswordResetProviderId:
                  'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
              });
              logger.info(`Updated Jellyfin permissions for user ${user.id}`);
            } catch (error) {
              logger.error('Failed to update Jellyfin permissions', {
                userId: user.id,
                errorMessage: error.message,
              });
            }
          }

          await userRepository.save(user);

          if (oldStatus === 'active') {
            notificationManager.sendNotification(
              Notification.SUBSCRIPTION_EXPIRED,
              {
                notifyUser: user,
                subject: 'Subscription Expired',
                message:
                  'Your subscription has expired. Some features may be restricted.',
                notifyAdmin: false,
                notifySystem: true,
              }
            );
          }

          logger.info(
            `User ${user.id} subscription expired, permissions updated`
          );
        } else if (
          user.subscriptionExpirationDate &&
          new Date(user.subscriptionExpirationDate) <= oneWeekFromNow &&
          new Date(user.subscriptionExpirationDate) > now &&
          !user.notifiedAboutExpiration
        ) {
          user.notifiedAboutExpiration = true;
          await userRepository.save(user);

          notificationManager.sendNotification(
            Notification.SUBSCRIPTION_EXPIRING,
            {
              notifyUser: user,
              subject: 'Subscription Expiring Soon',
              message:
                'Your subscription will expire soon. Please renew to avoid service interruption.',
              notifyAdmin: false,
              notifySystem: true,
            }
          );

          logger.info(
            `Warning sent to user ${user.id} about subscription expiring on ${user.subscriptionExpirationDate}`
          );
        }
      }
    } catch (error) {
      logger.error('Failed to run Subscription Sync job', {
        label: 'Subscriptions',
        errorMessage: error.message,
      });
    }
  },
};

export default subscriptionsSync;
