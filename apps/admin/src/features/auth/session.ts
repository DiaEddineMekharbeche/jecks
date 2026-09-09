import type { AuthTokens, Permission, SessionUser } from '@jecks/shared';
import { create } from 'zustand';
import { api, onSessionLost, setAccessToken } from '@/lib/api';

/**
 * Session state for the admin. The access token never touches localStorage — a page
 * reload silently re-mints it from the httpOnly refresh cookie (PRD Section 10.3).
 */

interface SessionState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  signIn: (email: string, password: string, totp?: string) => Promise<void>;
  signOut: () => Promise<void>;
  restore: () => Promise<void>;
  can: (...permissions: Permission[]) => boolean;
}

type LoginResponse = AuthTokens & { user: SessionUser };

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  status: 'loading',

  async signIn(email, password, totp) {
    const result = await api<LoginResponse>('/auth/staff/login', {
      method: 'POST',
      body: { email, password, ...(totp ? { totp } : {}) },
      skipRefresh: true,
    });
    setAccessToken(result.accessToken);
    set({ user: result.user, status: 'authenticated' });
  },

  async signOut() {
    await api<void>('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    set({ user: null, status: 'anonymous' });
  },

  /** Called once at boot; a missing or expired cookie simply means "not signed in". */
  async restore() {
    try {
      const result = await api<LoginResponse>('/auth/refresh', {
        method: 'POST',
        skipRefresh: true,
      });
      setAccessToken(result.accessToken);
      set({ user: result.user, status: 'authenticated' });
    } catch {
      setAccessToken(null);
      set({ user: null, status: 'anonymous' });
    }
  },

  can(...permissions) {
    const granted = get().user?.permissions ?? [];
    return permissions.every((permission) => granted.includes(permission));
  },
}));

// A refresh that fails mid-session drops the user back to the sign-in screen.
onSessionLost(() => {
  setAccessToken(null);
  useSession.setState({ user: null, status: 'anonymous' });
});
