import { create } from "zustand";

type AuthState = {
  accessToken: string | null;
  isHydrating: boolean;
  setAccessToken: (token: string) => void;
  clearAccessToken: () => void;
  setHydrating: (value: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  isHydrating: true,
  setAccessToken: (token: string) => set({ accessToken: token }),
  clearAccessToken: () => set({ accessToken: null }),
  setHydrating: (value: boolean) => set({ isHydrating: value }),
}));
