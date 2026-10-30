'use strict';
/** A server-observed position delta is required before a tunnel/survey
 * advance is credited. Dig commands or pathfinder acknowledgments alone do
 * not establish progress. This helper does not certify server authenticity.
 */
function confirmedMove(from,to,target,{minHorizontal=.45,maxTargetDistance=2.4}={}) {
  const coords=[from?.x,from?.y,from?.z,to?.x,to?.y,to?.z,target?.x,target?.y,target?.z];
  if(!coords.every(Number.isFinite))return false;
  if(!Number.isFinite(minHorizontal)||minHorizontal<=0 || !Number.isFinite(maxTargetDistance)||maxTargetDistance<=0)return false;
  const advance=Math.hypot(to.x-from.x,to.z-from.z);
  const remaining=Math.hypot(to.x-target.x,to.y-target.y,to.z-target.z);
  return advance>=minHorizontal && remaining<=maxTargetDistance;
}
module.exports={confirmedMove};
