import { Toaster, TooltipProvider } from '@jecks/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/router';
import { useSession } from './features/auth/session';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Admin data is read far more often than it changes; one minute is plenty and
      // keeps the dashboard off the database on every tab switch.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // A 401 is handled by the api layer's silent refresh; retrying is pointless.
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
    },
  },
});

function App() {
  const restore = useSession((state) => state.restore);

  // One refresh attempt at boot turns the httpOnly cookie back into a live session.
  useEffect(() => {
    void restore();
  }, [restore]);

  return <AppRoutes />;
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
