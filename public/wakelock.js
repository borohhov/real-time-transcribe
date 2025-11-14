let wakeLock = null;
const wakeLockAnalytics = window.appAnalytics;

async function requestWakeLock() {
  const supported = !!(navigator.wakeLock && navigator.wakeLock.request);
  wakeLockAnalytics?.capture('wake_lock_requested', { supported });
  try {
    // Request a screen wake lock
    wakeLock = await navigator.wakeLock.request('screen');
    console.log('Wake Lock is active');
    wakeLockAnalytics?.capture('wake_lock_acquired', {});
    
    // Re-acquire the lock if it is lost
    wakeLock.addEventListener('release', () => {
      console.log('Wake Lock was released');
      wakeLockAnalytics?.capture('wake_lock_released', { reason: 'system' });
    });
  } catch (err) {
    console.error(`${err.name}, ${err.message}`);
    wakeLockAnalytics?.capture('wake_lock_failed', {
      errorName: err.name,
      errorMessage: err.message,
    });
  }
}

// To release the wake lock when done
function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release()
      .then(() => {
        wakeLock = null;
        console.log('Wake Lock has been released');
        wakeLockAnalytics?.capture('wake_lock_released', { reason: 'manual' });
      });
  }
}
