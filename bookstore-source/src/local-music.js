function canReadTrack(url) {
  return new Promise(resolve => {
    const preview = new Audio();
    const finish = (readable) => {
      clearTimeout(timeout);
      preview.onloadedmetadata = preview.onerror = null;
      preview.removeAttribute('src');
      preview.load();
      resolve(readable);
    };
    const timeout = setTimeout(() => finish(false), 5000);
    preview.onloadedmetadata = () => finish(true);
    preview.onerror = () => finish(false);
    preview.preload = 'metadata';
    preview.src = url;
    preview.load();
  });
}

/** Local files only: object URLs never upload music or add network dependencies. */
export function createLocalMusic({ audio, makeURL = file => URL.createObjectURL(file),
  revokeURL = url => URL.revokeObjectURL(url), probeURL = canReadTrack, onChange = () => {} }) {
  let tracks = [], index = -1, disposed = false, error = '', epoch = 0, importEpoch = 0;
  const listeners = [];
  const snapshot = () => ({ tracks: tracks.map(track => track.name), index,
    title: tracks[index]?.name || '尚未导入音乐', playing: !audio.paused && index >= 0,
    time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0, volume: audio.volume, error });
  const notify = () => { if (!disposed) onChange(snapshot()); };
  const listen = (name, handler) => { audio.addEventListener(name, handler); listeners.push([name, handler]); };

  async function play() {
    if (index < 0 || disposed) return false;
    const token = ++epoch;
    error = '';
    try { await audio.play(); if (!disposed && token === epoch) notify(); return !disposed && token === epoch; }
    catch (reason) {
      if (token !== epoch || disposed) return false;
      error = reason?.name === 'NotAllowedError' ? '点击播放开始音乐' : '这个音频暂时无法播放，请换一首或换用 MP3 / WAV';
      notify(); return false;
    }
  }
  function pause() { epoch++; audio.pause(); notify(); }
  async function select(next, autoplay = false) {
    if (disposed || !tracks.length) return false;
    pause();
    index = (next + tracks.length) % tracks.length;
    error = '';
    audio.src = tracks[index].url;
    audio.load();
    notify();
    return autoplay ? play() : true;
  }
  async function importFiles(files) {
    if (disposed) return 0;
    const token = ++importEpoch;
    const accepted = [...files].filter(file => file.type?.startsWith('audio/') ||
      /\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i.test(file.name));
    if (!accepted.length) { error = '请选择本地音频文件'; notify(); return 0; }
    // Allocate first so a failed replacement cannot destroy a working playlist.
    const next = [];
    const playable = [];
    let commit = false;
    try {
      for (const file of accepted) {
        const track = { name: file.name, url: makeURL(file) };
        next.push(track);
        if (await probeURL(track.url)) playable.push(track);
        if (disposed || token !== importEpoch) return 0;
      }
      if (!playable.length) { error = '无法播放所选音频，请检查文件'; notify(); return 0; }
      commit = true;
    } catch {
      if (!disposed && token === importEpoch) { error = '无法读取所选音乐'; notify(); }
      return 0;
    } finally {
      const kept = new Set(commit ? playable : []);
      for (const track of next) if (!kept.has(track)) revokeURL(track.url);
    }
    pause(); audio.removeAttribute('src'); audio.load();
    tracks.forEach(track => revokeURL(track.url));
    tracks = playable; index = -1;
    await select(0, true);
    return disposed || token !== importEpoch ? 0 : playable.length;
  }
  listen('ended', () => { if (tracks.length > 1) select(index + 1, true); else { audio.currentTime = 0; notify(); } });
  listen('error', () => { error = '音频解码失败，可切换下一首或重新导入'; notify(); });
  for (const name of ['play','pause','timeupdate','loadedmetadata','durationchange','volumechange']) listen(name, notify);
  return { importFiles, play, pause, snapshot, select,
    toggle: () => audio.paused ? play() : pause(),
    next: () => select(index + 1, true), previous: () => select(index - 1, true),
    seek(value) { if (Number.isFinite(value) && Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Math.max(0, Math.min(value, audio.duration)); },
    setVolume(value) { audio.volume = Math.max(0, Math.min(1, Number(value) || 0)); },
    dispose() {
      if (disposed) return;
      disposed = true; epoch++; importEpoch++; audio.pause(); audio.removeAttribute('src'); audio.load();
      listeners.forEach(([name, handler]) => audio.removeEventListener(name, handler));
      tracks.forEach(track => revokeURL(track.url)); tracks = []; index = -1;
    } };
}
