import Modal from '@app/components/Common/Modal';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type { StatusResponse } from '@server/interfaces/api/settingsInterfaces';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.StatusChecker', {
  appUpdated: '{applicationTitle} Updated',
  appUpdatedDescription:
    'Please click the button below to reload the application.',
  reloadApp: 'Reload {applicationTitle}',
  restartRequired: 'Server Restart Required',
  restartRequiredDescription:
    'Please restart the server to apply the updated settings.',
});

const StatusChecker = () => {
  const intl = useIntl();
  const settings = useSettings();
  const { data, error } = useSWR<StatusResponse>('/api/v1/status', {
    refreshInterval: 60 * 1000,
  });

  if (!data || error || !data.version) {
    return null;
  }

  // Only show modal if not running a fork
  if (!data.forkedFromVersion) {
    return (
      <Transition
        as={Fragment}
        show={
          (data.updateAvailable || data.restartRequired) &&
          data.commitTag !== 'local'
        }
        enter="transition ease-out duration-150"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Modal
          title={intl.formatMessage(messages.appUpdated, {
            applicationTitle: settings.currentSettings.applicationTitle,
          })}
          onOk={() => location.reload()}
          okText={intl.formatMessage(messages.reloadApp, {
            applicationTitle: settings.currentSettings.applicationTitle,
          })}
          backgroundClickable={false}
        >
          {intl.formatMessage(messages.appUpdatedDescription)}
        </Modal>
      </Transition>
    );
  }

  return null;
};

export default StatusChecker;
