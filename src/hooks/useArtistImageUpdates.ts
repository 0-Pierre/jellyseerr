import { useRouter } from 'next/router';
import { useEffect } from 'react';

let eventSource: EventSource | null = null;
const listeners = new Set<
  (data: {
    id: string;
    urls: {
      artistThumb: string | null;
      artistBackground: string | null;
    };
  }) => void
>();

export const useArtistImageUpdates = (
  onUpdate: (data: {
    id: string;
    urls: {
      artistThumb: string | null;
      artistBackground: string | null;
    };
  }) => void
) => {
  const router = useRouter();

  useEffect(() => {
    if (!eventSource) {
      eventSource = new EventSource('/tadbproxy/updates');
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        listeners.forEach((listener) => listener(data));
      };
    }

    listeners.add(onUpdate);

    const handleRouteChange = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    router.events.on('routeChangeStart', handleRouteChange);

    return () => {
      listeners.delete(onUpdate);
      router.events.off('routeChangeStart', handleRouteChange);

      if (listeners.size === 0 && eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [onUpdate, router]);
};
