'use client';

import { MediaModelsPanelView } from './media-models-panel-view';
import { useDiscoverVideoModels, useUpdateVideoConnection, useVideoConnection, useVideoProfiles, useUpdateVideoProfile } from './use-video-config';

export function VideoModelsPanel() {
  const connection = useVideoConnection();
  const save = useUpdateVideoConnection();
  const discovery = useDiscoverVideoModels();
  const profiles = useVideoProfiles();
  const update = useUpdateVideoProfile();
  return <MediaModelsPanelView kind="video" connection={connection} save={save} discovery={discovery}
    profiles={profiles} updating={update.isPending} onDisable={(profile) => update.mutateAsync({
      profileId: profile.profileId, dto: { expectedConfigVersion: profile.configVersion, enabled: false },
    })} />;
}
