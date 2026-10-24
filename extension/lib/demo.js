export function createDemo(id, audioContext) {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d'); const started = performance.now();
  let timer, frame = 0;
  function paint() {
    const t = (performance.now() - started) / 1000, w = canvas.width, h = canvas.height;
    if (id === 'A') {
      const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#526b68'); sky.addColorStop(.6, '#b0c6af'); sky.addColorStop(1, '#466055'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f4d9a5'; ctx.beginPath(); ctx.arc(920, 200, 55, 0, Math.PI * 2); ctx.fill();
      for (let layer = 0; layer < 4; layer++) {
        ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, 320 + layer * 75);
        for (let x = 0; x <= w; x += 6) { const y = 320 + layer * 76 + Math.sin(x / (180 - layer * 17) + layer * 2 + t * .025) * (80 - layer * 10) + Math.sin(x / 57 + layer) * 20; ctx.lineTo(x, y); }
        ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = ['#678879', '#4a7265', '#345748', '#203e33'][layer]; ctx.fill();
      }
      ctx.fillStyle = '#173d32bb'; ctx.fillRect(0, h - 100, w, 100);
      ctx.fillStyle = '#d0e6d2'; ctx.font = '500 30px "Microsoft YaHei", sans-serif'; ctx.fillText('山野电台', 53, h - 51);
      ctx.fillStyle = '#92b49c'; ctx.font = '14px "Segoe UI", sans-serif'; ctx.fillText('SLOW DOWN. TUNE IN.', 54, h - 24);
      ctx.fillStyle = '#abc6aa'; ctx.font = '16px Consolas, monospace'; ctx.fillText(`${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`, w - 100, h - 45);
      for (let i = 0; i < 3; i++) { const bx = ((t * (18 + i * 4) + i * 190) % (w + 100)) - 50, by = 170 + Math.sin(t * .6 + i) * 13; ctx.beginPath(); ctx.strokeStyle = '#314f43'; ctx.lineWidth = 2; ctx.moveTo(bx - 9, by - 3); ctx.quadraticCurveTo(bx - 3, by - 7, bx, by); ctx.quadraticCurveTo(bx + 3, by - 7, bx + 9, by - 3); ctx.stroke(); }
    } else {
      const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#312e49'); bg.addColorStop(1, '#181f34'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#a295c113'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.save(); ctx.translate(640, 325); ctx.rotate(t * .12);
      const glow = ctx.createRadialGradient(0, 0, 80, 0, 0, 270); glow.addColorStop(0, '#8172ae35'); glow.addColorStop(1, '#8172ae00'); ctx.fillStyle = glow; ctx.fillRect(-300, -300, 600, 600);
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(0, 0, 200, 75 + i * 7, i * Math.PI / 6, 0, Math.PI * 2); ctx.strokeStyle = i % 2 ? '#b1a1d875' : '#a6d8d660'; ctx.lineWidth = 1.8; ctx.stroke(); }
      ctx.fillStyle = '#d1b9d0'; ctx.beginPath(); ctx.arc(Math.cos(t) * 200, Math.sin(t) * 82, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#cfc7e3'; ctx.font = '300 49px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('NIGHT ORBIT', 640, 338); ctx.fillStyle = '#9b90b9'; ctx.font = '13px "Segoe UI", sans-serif'; ctx.fillText('MUSIC FOR THE IN-BETWEEN', 640, 373); ctx.textAlign = 'left';
      ctx.fillStyle = '#171c2cdd'; ctx.fillRect(0, h - 100, w, 100); ctx.fillStyle = '#cbc3e0'; ctx.font = '500 30px "Microsoft YaHei", sans-serif'; ctx.fillText('夜航音乐站', 53, h - 51); ctx.fillStyle = '#8d87ac'; ctx.font = '14px "Segoe UI", sans-serif'; ctx.fillText('A LITTLE SPACE TO FEEL.', 54, h - 24);
      for (let i = 0; i < 35; i++) { const height = 6 + Math.abs(Math.sin(t * 2 + i * .5) * Math.cos(i * .3)) * 38; ctx.fillStyle = '#9e95ba'; ctx.fillRect(920 + i * 7, h - 46 - height / 2, 3, height); }
    }
    ctx.fillStyle = '#0b161bcc'; ctx.fillRect(34, 28, 126, 28); ctx.fillStyle = id === 'A' ? '#b5f4d5' : '#c9baf5'; ctx.font = '13px "Microsoft YaHei", sans-serif'; ctx.fillText(`演示素材 · ${id}`, 47, 48); frame++;
  }
  paint(); timer = setInterval(paint, 1000 / 30);
  const stream = canvas.captureStream(30);
  // A very quiet synthetic tone makes the audio path and meters testable.
  const oscillator = audioContext.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = id === 'A' ? 174.61 : 261.63;
  const gain = audioContext.createGain(); gain.gain.value = .025;
  const destination = audioContext.createMediaStreamDestination(); oscillator.connect(gain); gain.connect(destination); oscillator.start();
  destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
  return { stream, stop() { clearInterval(timer); oscillator.stop(); oscillator.disconnect(); gain.disconnect(); destination.disconnect(); stream.getTracks().forEach(track => track.stop()); } };
}
