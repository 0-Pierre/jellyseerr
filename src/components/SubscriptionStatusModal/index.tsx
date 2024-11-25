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
  titleExpired: 'Your annual subscription has expired, renew it for {subscriptionPrice}€, only.',
  titleNoSubscription: "{subscriptionPrice}€ per year, that's all.",
  messageExpired: 'Your subscription expired on {expirationDate}. To renew, simply click the button below or access your profile in the top right corner. Ensure your PayPal account name matches your Jellyseerr account name and that the amount is exactly {subscriptionPrice} € to avoid any payment automatic detection issues. Once renewed, you will regain the ability to request content on Jellyseerr and stream media on Jellyfin seamlessly.',
  messageNoSubscription: 'You currently do not have an active subscription. You can subscribe by clicking on the button below or directly in your profile in the top right. Ensure that the name on your PayPal account matches the name on your Jellyseerr account and that the subscription price is exactly {subscriptionPrice}€ to avoid any payment automatic detection issues. Upon subscribing, you will have the ability to request new content on Jellyseerr and stream all these media directly on Jellyfin.',
  closeButton: 'Close',
  renewButton: 'Renew Subscription',
  subscribeButton: 'Subscribe Now',
  manualProcessingMessage: "If your payment isn't detected automatically within the next few minutes, don't worry. I'll process it manually when I'll the time."
});

const SubscriptionStatusModal = () => {
  const [isOpen, setIsOpen] = useState(false);
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
      return intl.formatMessage(messages.titleExpired, {
        subscriptionPrice: currentSettings.subscriptionPrice
      });
    }
    return intl.formatMessage(messages.titleNoSubscription, {
      subscriptionPrice: currentSettings.subscriptionPrice
    });
  };

  const getMessage = () => {
    if (user?.subscriptionStatus === 'expired' && user?.subscriptionExpirationDate) {
      const formattedDate = format(new Date(user.subscriptionExpirationDate), 'PP');
      return intl.formatMessage(messages.messageExpired, {
        expirationDate: formattedDate,
        subscriptionPrice: currentSettings.subscriptionPrice
      });
    }
    return intl.formatMessage(messages.messageNoSubscription, {
      subscriptionPrice: currentSettings.subscriptionPrice
    });
  };

  const handleActionClick = () => {
    window.open(`${currentSettings.paypalMeLink}/${currentSettings.subscriptionPrice}`, '_blank');
    setIsOpen(false);
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
          <p className="text-white">
            {getMessage()}
          </p>
          <p className="text-gray-400 mt-6 mb-6">{intl.formatMessage(messages.manualProcessingMessage)}</p>
        </div>
      </Modal>
    </Transition>
  );
};

export default SubscriptionStatusModal;
