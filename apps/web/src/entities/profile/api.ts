import type { CreateProfileInput, Profile, UpdateProfileInput } from '@budget/shared';
import { api } from '@/shared/api/client';

export interface ProfilesResponse {
  activeProfileId: string | null;
  items: Profile[];
}

export interface ProfileRemovedResponse {
  removedId: string;
  /** Кто стал активным вместо удалённого — интерфейсу нужно знать, что открывать. */
  activeProfileId: string | null;
  items: Profile[];
}

export const profileApi = {
  list: () => api.get<ProfilesResponse>('/profiles'),

  create: (input: CreateProfileInput) => api.post<Profile>('/profiles', input),

  rename: (profileId: string, input: UpdateProfileInput) =>
    api.patch<Profile>(`/profiles/${profileId}`, input),

  activate: (profileId: string) => api.post<Profile>(`/profiles/${profileId}/activate`),

  remove: (profileId: string) => api.delete<ProfileRemovedResponse>(`/profiles/${profileId}`),
};
