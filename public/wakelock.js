let wakeLock = null;

async function requestWakeLock() {
  try {
    // Request a screen wake lock
    wakeLock = await navigator.wakeLock.request('screen');
    console.log('Wake Lock is active');
    
    // Re-acquire the lock if it is lost
    wakeLock.addEventListener('release', () => {
      console.log('Wake Lock was released');
    });
  } catch (err) {
    console.error(`${err.name}, ${err.message}`);
  }
}

// To release the wake lock when done
function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release()
      .then(() => {
        wakeLock = null;
        console.log('Wake Lock has been released');
      });
  }
}
