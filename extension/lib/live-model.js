// Live-room API data is kept separate from the scene: signed URLs and tokens
// never enter saved scenes or exports.
export function parsePlayInfo(payload) {
  const data = payload?.data;
  if (payload?.code !== 0 || !data) throw new Error(payload?.message || '获取直播信息失败');
  if (data.live_status !== 1) throw new Error('该直播间当前未开播');
  const play = data.playurl_info?.playurl;
  const descriptions = new Map((play?.g_qn_desc || []).map(item => [item.qn, item.desc]));
  const streams = [];
  for (const protocol of play?.stream || []) for (const format of protocol.format || []) {
    for (const codec of format.codec || []) {
      if (codec.codec_name !== 'avc') continue;
      const type = protocol.protocol_name === 'http_hls' ? 'hls' : format.format_name === 'flv' ? 'flv' : null;
      if (!type) continue;
      for (const info of codec.url_info || []) {
        const url = `${info.host}${codec.base_url}${info.extra || ''}`;
        if (!isMediaUrl(url)) continue;
        streams.push({ type, format: format.format_name, url, quality: codec.current_qn,
          accepted: (codec.accept_qn || []).filter(Number.isFinite) });
      }
    }
  }
  // HLS carries a seekable A/V timeline and can carry program-date-time.
  streams.sort((a, b) => (a.type === 'hls' ? 0 : 1) - (b.type === 'hls' ? 0 : 1) ||
    (a.format === 'fmp4' ? 0 : 1) - (b.format === 'fmp4' ? 0 : 1));
  if (!streams.length) throw new Error('直播间暂时没有可播放的音视频线路，请稍后重连');
  const available = [...new Set(streams.flatMap(item => [item.quality, ...item.accepted]))]
    .filter(Number.isFinite).sort((a, b) => b - a);
  return { roomId: String(data.room_id), liveTime: data.live_time, streams,
    qualities: available.map(value => ({ value, label: descriptions.get(value) || `画质 ${value}` })) };
}

export function isMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['bilivideo.com', 'bilivideo.cn', 'biliapi.net', 'mcdn.bilivideo.cn']
      .some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

export function availableRanges(buffered) {
  const ranges = [];
  for (let i = 0; i < (buffered?.length || 0); i++) ranges.push([buffered.start(i), buffered.end(i)]);
  return ranges;
}

export function synchronizationTarget({ ranges, latency, playingDate, currentTime, now = Date.now(), edgeTime = now }) {
  if (!ranges.length) return null;
  const [start, end] = ranges.at(-1);
  const wallTime = playingDate instanceof Date ? playingDate.getTime() : NaN;
  const dated = Number.isFinite(wallTime);
  // Segment edges arrive in batches; interpolate so playback keeps advancing
  // between arrivals instead of seeking back to a stationary buffered end.
  const target = dated ? currentTime + (now - latency * 1000 - wallTime) / 1000 : end - latency + Math.max(0, now - edgeTime) / 1000;
  if (target < start + 0.05) return { wait: true, mode: dated ? '直播时间' : '缓冲进度', buffered: end - start };
  return { wait: false, time: Math.min(end - 0.1, Math.max(start + 0.05, target)),
    mode: dated ? '直播时间' : '缓冲进度', buffered: end - start };
}
