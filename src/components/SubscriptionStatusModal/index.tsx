// src/components/SubscriptionStatusModal/index.tsx
import Modal from '@app/components/Common/Modal';
import { useUser } from '@app/hooks/useUser';
import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { format } from 'date-fns';
import useSettings from '@app/hooks/useSettings';

const messages = defineMessages('components.SubscriptionModal', {
  titleExpired: 'Your subscription has expired.',
  titleNoSubscription: "You don't have an active subscription, for the moment.",
  messageExpired: 'Your subscription has expired on {expirationDate}. You can renew your access by clicking the button below or directly in your profile at the top right corner. This will restore your ability to request content on Jellyseerr and stream all media on Jellyfin.',
  messageNoSubscription: 'You currently do not have an active subscription. You can subscribe by clicking on the button below or directly in your profile on top right. Upon subscribing, you will have the ability to request new content on Jellyseerr and stream all these media directly on Jellyfin.',
  closeButton: 'Close',
  renewButton: 'Renew Subscription',
  subscribeButton: 'Subscribe Now'
});

const SubscriptionStatusModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showPaypal, setShowPaypal] = useState(false);
  const { user } = useUser();
  const { currentSettings } = useSettings();
  const intl = useIntl();

  useEffect(() => {
    if (user?.id) {
      const wasShown = sessionStorage.getItem('subscriptionPopupShown');
      const hasExpiredSubscription = user.subscriptionStatus === 'expired';
      const hasNoSubscription = !user.subscriptionStatus;
      const needsSubscription = hasExpiredSubscription || hasNoSubscription;

      if (!wasShown && needsSubscription) {
        const timer = setTimeout(() => {
          setIsOpen(true);
          sessionStorage.setItem('subscriptionPopupShown', 'true');
        }, 1000);

        return () => clearTimeout(timer);
      }
    }
  }, [user]);

  const getActionButton = () => {
    if (user?.subscriptionStatus === 'expired') {
      return intl.formatMessage(messages.renewButton);
    }
    return intl.formatMessage(messages.subscribeButton);
  };

  const getTitle = () => {
    if (user?.subscriptionStatus === 'expired') {
      return intl.formatMessage(messages.titleExpired);
    }
    return intl.formatMessage(messages.titleNoSubscription);
  };

  const getMessage = () => {
    if (user?.subscriptionStatus === 'expired' && user?.subscriptionExpirationDate) {
      const formattedDate = format(new Date(user.subscriptionExpirationDate), 'PP');
      return intl.formatMessage(messages.messageExpired, {
        expirationDate: formattedDate
      });
    }
    return intl.formatMessage(messages.messageNoSubscription);
  };

  const handleActionClick = () => {
    setShowPaypal(true);
  };

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      appear
      show={isOpen}
    >
      <Modal
        title={getTitle()}
        onCancel={() => setIsOpen(false)}
        cancelText={intl.formatMessage(messages.closeButton)}
        onOk={handleActionClick}
        okText={getActionButton()}
        backgroundClickable={false}
      >
        <div className="mt-6">
          {!showPaypal ? (
            <p className="text-gray-200">
              {getMessage()}
            </p>
          ) : (
            <div className="w-full text-center">
              <a
                href={`${currentSettings.paypalMeLink}/${currentSettings.subscriptionPrice}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-150 ease-in-out"
              >
                {getActionButton()}
              </a>
              <p className="mt-2 text-sm text-gray-400">
                You will be redirected to PayPal to complete your payment
              </p>
            </div>
          )}
        </div>
      </Modal>
    </Transition>
  );
};

export default SubscriptionStatusModal;
