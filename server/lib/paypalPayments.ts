import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import Imap from 'imap';
import type { Readable } from 'stream';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import logger from '@server/logger';
import { getSettings } from '@server/lib/settings';
import { deburr } from 'lodash';

const paypalPayments = {
  async run() {
    const settings = getSettings();
    const emailOpts = settings.notifications.agents.email.options;

    if (!emailOpts.authUser || !emailOpts.authPass || !emailOpts.smtpHost) {
      logger.error('Missing email configuration', { label: 'PayPalPayments' });
      return;
    }

    const imapConfig: Imap.Config = {
      user: emailOpts.authUser,
      password: emailOpts.authPass,
      host: emailOpts.smtpHost.replace('smtp', 'imap'),
      port: 993,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: true,
        servername: emailOpts.smtpHost.replace('smtp', 'imap')
      }
    };

    return new Promise<void>((resolve, reject) => {
      const imap = new Imap(imapConfig);
      const userRepository = getRepository(User);

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err: Error | null) => {
          if (err) {
            logger.error('Error opening inbox:', { label: 'PayPalPayments', error: err });
            imap.end();
            reject(err);
            return;
          }

          const searchCriteria = [
            ['FROM', 'service@paypal.fr'],
            ['SUBJECT', "Vous avez reçu de l'argent"],
            ['SINCE', new Date(Date.now() - 5 * 24 * 3600 * 1000)]
          ];

          imap.search(searchCriteria, async (err: Error | null, results) => {
            if (err) {
              logger.error('Search error:', { label: 'PayPalPayments', error: err });
              imap.end();
              return;
            }

            if (!results.length) {
              logger.info('No PayPal payment emails found', { label: 'PayPalPayments' });
              imap.end();
              resolve();
              return;
            }

            results.sort((a, b) => b - a);
            const lastEmail = results[0];

            const f = imap.fetch(lastEmail, { bodies: '' });

            f.on('message', (msg) => {
              msg.on('body', (stream: Readable) => {
                simpleParser(stream, async (err: Error | null, parsed: ParsedMail) => {
                  if (err) {
                    logger.error('Parser error:', { label: 'PayPalPayments', error: err });
                    return;
                  }

                  const bodyText = parsed.text || '';
                  const nameMatch = bodyText.match(/([A-Za-zÀ-ÿ-]+)\s+([A-Za-zÀ-ÿ-]+)\s+vous a envoyé\s+([0-9,]+)\s+€\s+EUR/);

                  if (nameMatch) {
                    const firstName = nameMatch[1];
                    const lastName = nameMatch[2];
                    const amount = parseFloat(nameMatch[3].replace(',', '.'));

                    const normalize = (str: string) => deburr(str).toLowerCase();

                    const users = await userRepository.find();
                    const matchingUser = users.find(user => {
                      const [userFirst, userLast] = user.displayName.split(' ');
                      return normalize(userFirst) === normalize(firstName) &&
                             normalize(userLast) === normalize(lastName);
                    });

                    if (matchingUser && amount >= Number(settings.main.subscriptionPrice)) {
                      if (!matchingUser.subscriptionStatus || matchingUser.subscriptionStatus === 'expired') {
                        matchingUser.subscriptionStatus = 'active';
                        const expirationDate = new Date();
                        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
                        matchingUser.subscriptionExpirationDate = expirationDate;
                        matchingUser.permissions = 1289765024;

                        await userRepository.save(matchingUser);
                        logger.info(`Subscription activated for user ${matchingUser.displayName}`, {
                          label: 'PayPalPayments',
                          amount,
                          date: parsed.date
                        });
                      }
                    }
                  }
                });
              });
            });

            f.once('end', () => {
              imap.end();
              resolve();
            });
          });
        });
      });

      imap.once('error', (err: Error) => {
        logger.error('IMAP Connection error:', { label: 'PayPalPayments', error: err });
        reject(err);
      });

      imap.connect();
    });
  }
};

export default paypalPayments;
