'use client';

import { MediaModelsPanelView } from './media-models-panel-view';
import { useDiscoverMediaModels, useMediaConnection, useMediaProfiles, useUpdateMediaConnection, useUpdateMediaProfile } from './use-media-config';

export function ImageModelsPanel() {
  const connection = useMediaConnection();
  const save = useUpdateMediaConnection();
  const discovery = useDiscoverMediaModels();
  const profiles = useMediaProfiles();
  const update = useUpdateMediaProfile();
  return <MediaModelsPanelView kind="image" connection={connection} save={save} discovery={discovery}
    profiles={profiles} updating={update.isPending} onDisable={(profile) => update.mutateAsync({
      profileId: profile.profileId, dto: { expectedConfigVersion: profile.configVersion, enabled: false },
    })} />;
}
