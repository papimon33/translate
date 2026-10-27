/* PC 새 화면(?ui=v2) — 세션 큰 설정에 끼우는 PC 전용 줄(폰엔 없는 기능).
   폰 세션 화면(MobileLive)이 desktop 일 때만 쓴다. 값·동작은 TranslateView 의 PC 상태 그대로(기능 유지).
   반환: { input, session, sheets } — input·session 은 큰 설정의 '입력'·'세션' 묶음에 넣을 줄들, sheets 는 고르는 시트. */
import React, { useState } from 'react';
import { OptionRow, PickSheet } from '../mobile/common.jsx';

export function usePcRows(pc, t, toast) {
  const [pick, setPick] = useState(null); // 'source' | 'mic' | 'mode'
  if (!pc) return { input: [], session: [], sheets: null };
  const close = () => setPick(null);
  const locked = (fn) => () => { if (pc.recording) { toast(t('lockedWhileRec')); return; } fn(); };
  const srcName = (v) => ({ mic: t('srcMic'), system: t('srcSystem'), both: t('srcBoth') }[v] || v);
  const micName = () => {
    if (!pc.micId) return t('defaultMic');
    const d = (pc.micDevs || []).find((x) => x.deviceId === pc.micId);
    return d ? (d.label || t('srcMic')) : t('defaultMic');
  };
  const modeName = (v) => (v === 'twoway' ? t('modeTwoway') : t('modeOneway'));
  const input = [
    <OptionRow key="pc-src" label={t('pcSource')} value={srcName(pc.sourceMode)} onClick={locked(() => setPick('source'))} />,
    pc.sourceMode !== 'system' && <OptionRow key="pc-mic" label={t('pcMicDevice')} value={micName()} onClick={locked(() => setPick('mic'))} />,
  ].filter(Boolean);
  const session = [
    pc.mode && <OptionRow key="pc-mode" label={t('pcMode')} value={modeName(pc.mode)} onClick={locked(() => setPick('mode'))} />,
    <OptionRow key="pc-adv" label={t('advanced')} onClick={pc.onAdvanced} />,
    pc.isElectron && <OptionRow key="pc-ov" label={t('overlayWin')} onClick={pc.onOverlay} />,
  ].filter(Boolean);
  const sheets = (
    <>
      <PickSheet open={pick === 'source'} onClose={close} title={t('pcSource')} value={pc.sourceMode}
        options={(pc.srcOpts || []).map((v) => ({ code: v, label: srcName(v) }))} onPick={pc.onSource} />
      <PickSheet open={pick === 'mic'} onClose={close} title={t('pcMicDevice')} value={(pc.micDevs || []).some((d) => d.deviceId === pc.micId) ? pc.micId : ''}
        options={[{ code: '', label: t('defaultMic') }, ...(pc.micDevs || []).map((d, i) => ({ code: d.deviceId, label: d.label || `${t('srcMic')} ${i + 1}` }))]}
        onPick={pc.onMicId} />
      <PickSheet open={pick === 'mode'} onClose={close} title={t('pcMode')} value={pc.mode}
        options={['oneway', 'twoway'].map((v) => ({ code: v, label: modeName(v), sub: v === 'twoway' ? t('modeTwowayDesc') : t('modeOnewayDesc') }))} onPick={pc.onMode} />
    </>
  );
  return { input, session, sheets };
}
