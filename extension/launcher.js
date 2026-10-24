import { openStudio } from './lib/launch.js';

// The popup is a browser-managed entry point, independent of service-worker
// startup. Its normal link also works without the automatic opener script.
openStudio().then(() => {
  window.close();
}).catch(() => {
  const status = document.querySelector('#launch-status');
  status.textContent = '点击下方按钮，打开融合工作台';
  status.classList.add('error');
});
