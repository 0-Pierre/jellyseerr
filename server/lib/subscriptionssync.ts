import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import logger from '@server/logger';

const subscriptionsSync = {
  async run() {
    try {
      const userRepository = getRepository(User);
      const users = await userRepository.find({
        where: { subscriptionStatus: 'active' },
      });

      const now = new Date();

      for (const user of users) {
        if (user.subscriptionExpirationDate && new Date(user.subscriptionExpirationDate) < now) {
          user.subscriptionStatus = 'expired';
          await userRepository.save(user);
          logger.info(`User ${user.id} subscription expired.`);
        }
      }
    } catch (error) {
      logger.error('Failed to run Subscription Sync job', { errorMessage: error.message });
    }
  },
};

export default subscriptionsSync;
