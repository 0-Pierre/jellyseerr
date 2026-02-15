export const SUBSCRIBED_PERMISSION = 744538272;
export const NON_SUBSCRIBED_PERMISSION = 740343936;

export const isSubscribedStatus = (
  status: 'active' | 'expired' | 'lifetime' | null | undefined
): boolean => status === 'active' || status === 'lifetime';

