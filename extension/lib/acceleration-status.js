export function accelerationStatus(diagnostics) {
  const renderer = diagnostics?.producer?.compositor?.renderer, encoding = diagnostics?.producer?.encoding;
  if (!renderer) return null;
  const title = renderer.backend === 'webgl2' ? renderer.hardware === false ? 'WebGL2 软件合成' : renderer.hardware === true ? 'GPU · WebGL2 合成' : 'WebGL2 合成' : 'Canvas 合成';
  const device = renderer.renderer || renderer.vendor || '';
  const parts = [];
  if (encoding?.codec) parts.push(encoding.codec.replace(/^video\//i, ''));
  if (encoding?.implementation) parts.push(encoding.implementation);
  else if (encoding) parts.push('Edge 自动编码');
  if (encoding?.powerEfficient === true) parts.push('高效编码');
  if (encoding?.width && encoding?.height) parts.push(encoding.width + ' × ' + encoding.height);
  if (Number.isFinite(encoding?.fps)) parts.push(encoding.fps + ' 帧/秒');
  if (Number.isFinite(encoding?.bitrateMbps)) parts.push(encoding.bitrateMbps + ' Mbps');
  return { title, device, details: parts.join(' · ') };
}
