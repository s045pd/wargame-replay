import { useVideos } from '../store/videos';
import { FloatingVideoCard } from './FloatingVideoCard';

/**
 * Container for all active floating video cards. Renders nothing itself —
 * cards are `fixed`-positioned and use pointer events independently of the
 * map underneath.
 */
export function VideoPanel() {
  const activeIds = useVideos((s) => s.activeGroupIds);
  return (
    <>
      {activeIds.map((id, index) => (
        <FloatingVideoCard key={id} groupId={id} index={index} />
      ))}
    </>
  );
}
