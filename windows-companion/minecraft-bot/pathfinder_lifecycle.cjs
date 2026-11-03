'use strict';
/* JARVIS Minecraft companion — mineflayer-pathfinder cancellation semantics.

   ROOT CAUSE DOCUMENTED FROM THE ACTUAL LIBRARY (mineflayer-pathfinder 2.4.5,
   node_modules/mineflayer-pathfinder/index.js):

   - line 163  bot.pathfinder.stop = () => { stopPathing = true }
               `stop()` does NOT stop navigation. It only ARMS a sticky
               module-level latch.
   - line 139  resetPath(): `if (stopPathing) return stop()`
               The latch is consumed only by the NEXT resetPath(), which is
               reached from setGoal() (line 146) or setMovements() (line 151).
   - line 390  internal stop(): `stopPathing = false; stateGoal = null;
               path = []; bot.emit('path_stop'); fullStop()`
               This is the ONLY place the latch is cleared, and it emits
               'path_stop' at that moment.
   - lib/goto.js registers bot.on('path_stop', pathStopped) and
               bot.on('goal_updated', goalChangedListener) BEFORE calling
               bot.pathfinder.setGoal(goal).

   Consequence of arming the latch without consuming it: the very next
   goto() sets its goal, that setGoal() consumes the stale latch, emits
   'path_stop', and the brand-new navigation rejects immediately with
   'Path was stopped before it could be completed! Thus, the desired goal
   was not reached.' The bot never takes a single step.

   Because halt() runs at the start of every setMode()/startAction(), and a
   navigation timeout also armed the latch, the first navigation of every
   manual action (dig_block, collect_wood, come, navigate) was killed before
   it began, and one timeout poisoned every subsequent stance retry. That is
   the confirmed cause of "Pathfinder navigation could stop unexpectedly" and
   "arrival at a valid mining stance was not confirmed".

   The invariant enforced here: a cancellation must ARM and then CONSUME the
   latch, in that order, so no sticky state survives into the next route.
   Cancellation strength is unchanged — an in-flight goto() is still rejected
   and bot.clearControlStates()/fullStop() still run.
*/

/** Cancel navigation correctly: arm the latch, then consume it.
 *  Safe to call when idle and when no pathfinder plugin is loaded.
 *  @returns {boolean} true when a pathfinder interface was present. */
function stopPathfinder(bot){
  const pf = bot?.pathfinder;
  if(!pf) return false;
  // 1. Arm. Marks the current route for termination (index.js:163).
  if(typeof pf.stop === 'function') pf.stop();
  // 2. Consume. resetPath() sees the armed latch, runs internal stop(),
  //    clears it and emits 'path_stop' (index.js:139 -> 390). Rejecting the
  //    in-flight goto() here is the intended cancellation, not a side effect.
  if(typeof pf.setGoal === 'function') pf.setGoal(null);
  return true;
}

/** Clear a latch left armed by anything else before committing to a new route.
 *  When the latch is already clear this is an idempotent no-goal set, which
 *  resetPath() handles harmlessly while the bot is stationary. */
function clearStaleStop(bot){
  const pf = bot?.pathfinder;
  if(!pf || typeof pf.setGoal !== 'function') return false;
  pf.setGoal(null);
  return true;
}

module.exports = {stopPathfinder, clearStaleStop};
