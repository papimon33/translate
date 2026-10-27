/* 안드로이드 앱 폰 화면 공용 조각 — 바텀 시트·선택 목록·확인 창·마이크 장치 목록.
   웹 티(PC식 드롭다운·작은 버튼)를 없애는 게 목적이라 선택은 전부 아래에서 올라오는 시트로 한다. */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import { useT, endonym } from '../shared/i18n.js';
import { openOverlay, closeOverlay } from './backstack.js';
import { BRAND } from '../shared/brand.js';
import { BluetoothIcon, CheckIcon, ChevronRightIcon, HeadsetIcon, MicIcon, PhoneIcon, UsbIcon } from '../shared/icons.jsx';

export { MOBILE_UI } from '../shared/env.js';

export function rel(ts, t) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return t('justNow');
  if (m < 60) return t('minAgo', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('hourAgo', { n: h });
  return new Date(ts).toLocaleDateString(t.locale, { month: 'numeric', day: 'numeric' });
}

// 언어 고르는 목록: 큰 글씨 = 그 언어 자신의 이름, 작은 글씨 = 화면 언어로 부른 이름(같으면 생략)
export function langOptions(codes, t) {
  return codes.map((code) => {
    const label = code === 'auto' ? t('autoDetect') : endonym(code);
    const sub = code === 'auto' ? '' : t.lang(code);
    return { code, label, sub: sub && sub !== label ? sub : '' };
  });
}

// 시트·확인 창이 열려 있는 동안 뒤로가기 = 이 창 닫기(backstack.js)
export function useBackClose(open, onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const id = openOverlay(() => { if (ref.current) ref.current(); });
    return () => closeOverlay(id);
  }, [open]);
}

/* 번역(엔진) 없이 마이크만 켜서 지금 입력 크기를 본다 — 세션 화면 대기 중·설정의 입력 감도.
   앱은 네이티브 캡처(번역과 같은 원음 경로), 브라우저(개발 확인용)는 getUserMedia. 화면이 꺼지거나 앱이 뒤로 가면 끈다.
   stereo=true(양방향 통역)면 2채널로 열어 마이크 1·2(채널 1·2)를 따로 잰다 — 2채널을 못 여는 마이크면 r 은 null.
   반환 { l, r, layout } — l·r 은 onMeter 와 같은 0~100 dB 눈금(null = 꺼짐).
   layout(2채널일 때): 'mono' = 두 채널이 같은 신호(수신기 모노 모드의 복사본 — 조용할 때 잔잡음까지 똑같다),
   'stereo' = 두 채널이 따로 들어옴(잡음이 서로 다름), null = 아직 모름(신호가 완전한 0 등). 말하기 전에도 판별된다. */
const toDb = (rms) => Math.max(0, Math.min(100, ((20 * Math.log10(rms + 1e-8) + 60) / 60) * 100));
export function useIdleMeter(active, stereo = false) {
  const [lv, setLv] = useState({ l: null, r: null, layout: null });
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const run = active && visible;
  useEffect(() => {
    if (!run) { setLv({ l: null, r: null, layout: null }); return undefined; }
    let dead = false, stopFn = null, last = 0;
    let layout = null;
    const votes = []; // 최근 8프레임 좌우 상관 판정('m'|'s')
    const put = (l, r) => {
      const now = Date.now();
      if (now - last < 80) return;
      last = now;
      setLv({ l: toDb(l), r: r == null ? null : toDb(r), layout: r == null ? null : layout });
    };
    const pcm = (b64) => {
      const bin = atob(b64);
      const n = bin.length >> 1;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 0x8000) v -= 0x10000; out[i] = v / 32768; }
      return out;
    };
    const a = window.AndroidAudio;
    if (a && a.start) {
      window.__kacNA = (b64) => { // 1채널 프레임
        const x = pcm(b64);
        if (!x.length) return;
        let s = 0;
        for (let i = 0; i < x.length; i++) s += x[i] * x[i];
        put(Math.sqrt(s / x.length), null);
      };
      window.__kacNA2 = (b64) => { // 2채널 프레임(좌우 교차)
        const x = pcm(b64);
        const n = x.length >> 1;
        if (!n) return;
        let sl = 0, sr = 0, slr = 0;
        for (let i = 0; i < n; i++) { const L = x[2 * i], R = x[2 * i + 1]; sl += L * L; sr += R * R; slr += L * R; }
        const rl = Math.sqrt(sl / n), rr = Math.sqrt(sr / n);
        // 두 채널 모두 신호(잔잡음 포함)가 있을 때만 판정: 상관 0.98 초과 = 같은 신호(모노 복사본), 0.9 미만 = 따로 들어옴
        if (rl > 1e-4 && rr > 1e-4) {
          const corr = slr / Math.sqrt(sl * sr);
          votes.push(corr > 0.98 ? 'm' : corr < 0.9 ? 's' : '');
          if (votes.length > 8) votes.shift();
          const m = votes.filter((v) => v === 'm').length, s = votes.filter((v) => v === 's').length;
          if (m >= 6) layout = 'mono';
          else if (s >= 6) layout = 'stereo';
        }
        put(rl, rr);
      };
      let ok = false;
      try { ok = stereo && a.startStereo ? Number(a.startStereo()) > 0 : !!a.start(); } catch {}
      if (!ok) { window.__kacNA = null; window.__kacNA2 = null; return undefined; }
      stopFn = () => { try { a.stop(); } catch {} window.__kacNA = null; window.__kacNA2 = null; };
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        if (dead) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        let raf = 0;
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          put(Math.sqrt(s / buf.length), null);
          raf = requestAnimationFrame(tick);
        };
        tick();
        stopFn = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((tr) => tr.stop()); try { ctx.close(); } catch {} };
      }).catch(() => {});
    }
    return () => { dead = true; if (stopFn) stopFn(); };
  }, [run, stereo]);
  return lv;
}

// 송신기 1·2(좌·우) 2채널 상태 안내 — 번역 중 자동 판별(stereo/mono), 대기 중엔 확인 방법
export function stereoMsg(state, t) {
  return state === 'stereo' ? t('stereoOk') : state === 'mono' ? t('stereoMono') : t('stereoTry');
}

/* 지금 쓰는(또는 시작하면 쓸) 마이크 — 네이티브가 2초마다 알려준다.
   1.4.0 앱: inputs() 로 장치 목록·선택(setInput), 그 전 앱: inputLabel() 이름만, 브라우저: '마이크'. */
export function useMicInputs() {
  const read = () => {
    const a = window.AndroidAudio;
    let list = null, label = '';
    try { if (a && a.inputs) list = JSON.parse(String(a.inputs() || '[]')); } catch {}
    try { if (a && a.inputLabel) label = String(a.inputLabel() || ''); } catch {}
    return { list: Array.isArray(list) ? list : null, label };
  };
  const [st, setSt] = useState(read);
  useEffect(() => {
    const tm = setInterval(() => setSt(read()), 2000);
    return () => clearInterval(tm);
  }, []);
  const active = st.list ? st.list.find((d) => d.active) : null;
  const kind = active ? active.kind : /^USB/.test(st.label) ? 'usb' : /^유선/.test(st.label) ? 'wired' : /블루투스|Bluetooth/i.test(st.label) ? 'bluetooth' : 'builtin';
  const pick = (id) => {
    try { window.AndroidAudio.setInput(Number(id) || 0); } catch {}
    setTimeout(() => setSt(read()), 150);
  };
  return { list: st.list, label: st.label, kind, canPick: !!st.list, pick };
}

// 아래에서 올라오는 시트 — 아래로 쓸어내리면 닫힌다(SwipeableDrawer). 목록이 스크롤된 상태면 먼저 목록이 올라가고, 맨 위에서 더 내리면 닫힘.
// 쓸어 열기는 쓰지 않으므로 닫혀 있을 땐 내용을 내린다(keepMounted 끔 — 켜 두면 입력 시트의 autoFocus 가 열 때 동작하지 않는다).
const IOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
const noop = () => {};
export function BottomSheet({ open, onClose, title, subtitle, action, children, maxHeight = '86dvh' }) {
  useBackClose(open, onClose);
  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      onOpen={noop}
      disableSwipeToOpen
      disableDiscovery
      disableBackdropTransition={!IOS}
      ModalProps={{ keepMounted: false }}
      sx={{ zIndex: (th) => th.zIndex.modal + 1 }} /* 설정·계정(전체 화면 Dialog) 위에서도 열리게 — Drawer 기본 z-index 는 Dialog 보다 낮다 */
      slotProps={{ paper: { sx: { borderTopLeftRadius: '28px', borderTopRightRadius: '28px', maxHeight, bgcolor: 'background.paper', backgroundImage: 'none', pb: 'env(safe-area-inset-bottom)', width: { xs: 'auto', sm: 520 }, mx: 'auto' } } }} /* 넓은 화면(PC 새 화면)에선 가운데 폭 520 */
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight }}>
        <Box sx={{ alignSelf: 'center', width: 40, height: 4, borderRadius: '999px', bgcolor: 'divider', mt: 1.25, mb: 1.5, flex: 'none' }} />
        {(title || action) && (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, px: 3, pb: 1.5 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" sx={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.015em' }}>{title}</Typography>
              {subtitle && <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>{subtitle}</Typography>}
            </Box>
            {action}
          </Box>
        )}
        {children}
      </Box>
    </SwipeableDrawer>
  );
}

/* 하나 고르는 시트(테마·음성·언어). options: [{ code, label, sub?, extra? }] — 고르는 즉시 닫힌다. */
export function PickSheet({ open, onClose, title, subtitle, value, options, onPick, keepOpen }) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <Box role="radiogroup" aria-label={title} sx={{ overflowY: 'auto', px: 1.5, pb: 2.5, minHeight: 0 }}>
        {options.map((o) => {
          const on = o.code === value;
          return (
            <Box key={o.code} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, borderRadius: '16px', bgcolor: on ? 'action.hover' : 'transparent' }}>
              <ButtonBase role="radio" aria-checked={on} onClick={() => { onPick(o.code); if (!keepOpen) onClose(); }}
                sx={{ flex: 1, minHeight: 56, pl: 2, pr: 1, borderRadius: '16px', justifyContent: 'space-between', textAlign: 'left' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Typography sx={{ fontSize: 16.5, fontWeight: 700 }}>{o.label}</Typography>
                  {o.sub && <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{o.sub}</Typography>}
                </Box>
                {on && <CheckIcon aria-label={t('selected')} sx={{ fontSize: 22, flex: 'none' }} />}
              </ButtonBase>
              {o.extra}
            </Box>
          );
        })}
      </Box>
    </BottomSheet>
  );
}

/* 언어 선택 시트. tabs: [{ key, label, value, options:[{code,label,sub?}], onPick }] — 둘 이상이면 상단 세그먼트로 전환.
   단일 탭이면 고르는 즉시 닫힌다(한 번 탭 = 선택 완료). */
export function LangSheet({ open, onClose, title, subtitle, tabs, startTab = 0 }) {
  const t = useT();
  const [tab, setTab] = useState(startTab);
  useEffect(() => { if (open) setTab(startTab); }, [open, startTab]);
  const cur = tabs[Math.min(tab, tabs.length - 1)];
  const multi = tabs.length > 1;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      action={multi ? (
        <ButtonBase onClick={onClose} sx={{ height: 40, px: 2, borderRadius: '999px', bgcolor: 'action.hover', fontSize: 14, fontWeight: 700, flex: 'none' }}>{t('done')}</ButtonBase>
      ) : null}
    >
      {multi && (
        <Box role="tablist" sx={{ mx: 3, mb: 1.5, p: 0.5, borderRadius: '999px', bgcolor: 'action.hover', display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, gap: 0.5 }}>
          {tabs.map((tb, i) => (
            <ButtonBase
              key={tb.key}
              role="tab"
              aria-selected={i === tab}
              onClick={() => setTab(i)}
              sx={{ height: 44, borderRadius: '999px', fontSize: 14, fontWeight: 700, color: i === tab ? 'text.primary' : 'text.secondary', bgcolor: i === tab ? 'background.paper' : 'transparent', boxShadow: i === tab ? '0 1px 3px rgba(0,0,0,0.12)' : 'none', display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}
            >
              <span>{tb.label}</span>
              <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 500, color: 'text.secondary' }}>{t.lang(tb.value)}</Typography>
            </ButtonBase>
          ))}
        </Box>
      )}
      <Box sx={{ overflowY: 'auto', px: 1.5, pb: 2, minHeight: 0 }}>
        {cur.options.map((o) => {
          const on = o.code === cur.value;
          return (
            <ButtonBase
              key={o.code}
              onClick={() => { cur.onPick(o.code); if (!multi) onClose(); }}
              sx={{ width: '100%', minHeight: 56, px: 2, borderRadius: '16px', justifyContent: 'space-between', textAlign: 'left', bgcolor: on ? 'action.hover' : 'transparent' }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography sx={{ fontSize: 16.5, fontWeight: 700 }}>{o.label}</Typography>
                {o.sub && <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{o.sub}</Typography>}
              </Box>
              {on && <CheckIcon aria-label={t('selected')} sx={{ fontSize: 22 }} />}
            </ButtonBase>
          );
        })}
      </Box>
    </BottomSheet>
  );
}

// 가운데 확인 창(종료·삭제·로그아웃). danger = 빨간 확인 버튼.
export function ConfirmDialog({ open, title, desc, okLabel, danger, onOk, onClose, children, okDisabled, busy }) {
  const t = useT();
  useBackClose(open, () => { if (!busy) onClose(); });
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} slotProps={{ paper: { sx: { borderRadius: '24px', border: 0, m: 3.5, width: '100%', maxWidth: 360, backgroundImage: 'none' } } }}>
      <Box role="alertdialog" aria-label={title} sx={{ p: '24px 20px 18px', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography component="h2" sx={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.015em', textAlign: 'center', wordBreak: 'keep-all' }}>{title}</Typography>
        {desc && <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center', lineHeight: 1.55, wordBreak: 'keep-all' }}>{desc}</Typography>}
        {children}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25, mt: 1 }}>
          <ButtonBase onClick={onClose} disabled={busy} sx={{ height: 50, borderRadius: '14px', bgcolor: 'action.hover', fontSize: 15, fontWeight: 700 }}>{t('cancel')}</ButtonBase>
          <ButtonBase onClick={onOk} disabled={okDisabled || busy}
            sx={{ height: 50, borderRadius: '14px', bgcolor: danger ? 'error.main' : BRAND, color: '#fff', fontSize: 15, fontWeight: 700, opacity: okDisabled ? 0.45 : 1 }}>
            {busy ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : okLabel}
          </ButtonBase>
        </Box>
      </Box>
    </Dialog>
  );
}

/* 글자 입력 시트(세션 이름·사용자명·이메일·비밀번호). fields: [{ key, label, type?, placeholder?, autoComplete? }] */
export function FormSheet({ open, onClose, title, subtitle, fields, initial, okLabel, danger, validate, onSubmit }) {
  const t = useT();
  const [vals, setVals] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const firstRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setVals(initial || {}); setErr(''); setBusy(false);
    // eslint-disable-next-line
  }, [open]);
  const submit = async () => {
    if (busy) return;
    const v = validate ? validate(vals) : '';
    if (v) { setErr(v); return; }
    setBusy(true); setErr('');
    try { await onSubmit(vals); onClose(); }
    catch (e) { setErr(e.message || t('netError')); setBusy(false); }
  };
  return (
    <BottomSheet open={open} onClose={busy ? () => {} : onClose} title={title} subtitle={subtitle}>
      <Box component="form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} sx={{ px: 2.5, pb: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ borderRadius: '18px', bgcolor: 'action.hover', overflow: 'hidden' }}>
          {fields.map((f, i) => (
            <Box key={f.key} component="label" sx={{ display: 'flex', flexDirection: 'column', px: 2, pt: 1.25, pb: 1.25, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
              <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 500, color: 'text.secondary' }}>{f.label}</Typography>
              <InputBase
                inputRef={i === 0 ? firstRef : undefined}
                autoFocus={i === 0}
                type={f.type || 'text'}
                value={vals[f.key] || ''}
                onChange={(e) => setVals((o) => ({ ...o, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                inputProps={{ 'aria-label': f.label, autoComplete: f.autoComplete || 'off', autoCapitalize: 'none' }}
                sx={{ fontSize: 16, py: 0.25 }}
              />
            </Box>
          ))}
        </Box>
        {err && <Typography role="alert" sx={{ fontSize: 13.5, color: 'error.main', px: 0.5 }}>{err}</Typography>}
        <ButtonBase type="submit" disabled={busy}
          sx={{ height: 54, borderRadius: '16px', bgcolor: danger ? 'error.main' : BRAND, color: '#fff', fontSize: 16, fontWeight: 700, opacity: busy ? 0.7 : 1 }}>
          {busy ? <CircularProgress size={20} sx={{ color: 'inherit' }} /> : okLabel || t('save')}
        </ButtonBase>
      </Box>
    </BottomSheet>
  );
}

// 설정 목록의 한 줄(값 + ›). onClick 없으면 읽기 전용. toggle = 값 자리에 스위치(› 없음).
export function OptionRow({ label, value, onClick, danger, icon, disabled, toggle }) {
  const body = (
    <>
      {icon}
      <Typography sx={{ flex: 1, fontSize: 16, fontWeight: 700, color: danger ? 'error.main' : 'text.primary', textAlign: 'left' }}>{label}</Typography>
      {value != null && <Typography noWrap sx={{ fontSize: 14.5, color: 'text.secondary', maxWidth: '55%' }}>{value}</Typography>}
      {onClick && !danger && !toggle && <ChevronRightIcon sx={{ color: 'text.disabled', fontSize: 22 }} />}
    </>
  );
  const sx = { width: '100%', display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 54, pl: 2.25, pr: onClick ? 1.5 : 2.25, opacity: disabled ? 0.45 : 1 };
  return onClick
    ? <ButtonBase onClick={onClick} disabled={disabled} sx={sx}>{body}</ButtonBase>
    : <Box sx={sx}>{body}</Box>;
}

// 흰 카드 묶음(설정 섹션) — 줄 사이 구분선
export function Group({ title, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.9 }}>
      {title && <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary', px: 0.75 }}>{title}</Typography>}
      <Box sx={{ borderRadius: '18px', bgcolor: 'background.paper', overflow: 'hidden' }}>
        {items.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Box sx={{ height: '1px', bgcolor: 'divider', ml: 2.25 }} />}
            {c}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

/* 입력 감도 — 손잡이가 '이 크기를 넘는 소리만 인식' 기준선이다(왼쪽 끝 = 모든 소리). 손잡이 오른쪽 초록 = 인식, 왼쪽 노랑 = 무시.
   진한 선 = 지금 입력 크기(level: onMeter 와 같은 0~100 dB 눈금, 없으면 안 그림). 값은 기존 민감도(100=모든 소리) 그대로 저장한다.
   눈금 변환은 audio.js micGateAbs 의 역함수 — native(앱·원음)는 지수 곡선, 브라우저는 선형. */
function sensAtLevel(v, native) {
  const abs = Math.pow(10, ((v / 100) * 60 - 60) / 20);
  const k = native ? Math.log(abs / 0.004) / Math.log(50) : (abs - 0.004) / 0.03;
  return Math.max(0, Math.min(100, 100 - 100 * k));
}
export function SensSlider({ value, onChange, level, native, label, hint }) {
  const ref = useRef(null);
  const x = 100 - value; // 왼쪽 = 민감도 100
  const lx = level == null ? null : 100 - sensAtLevel(level, native);
  const setFrom = (clientX) => {
    const r = ref.current && ref.current.getBoundingClientRect();
    if (!r || !r.width) return;
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(Math.round(100 - p * 100));
  };
  const onDown = (e) => {
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    setFrom(e.clientX);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.min(100, value + 1)); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.max(0, value - 1)); }
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, px: 2.25, pt: 1.75, pb: 1.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{label}</Typography>
        <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      </Box>
      <Box
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        onPointerDown={onDown}
        onPointerMove={(e) => { if (e.buttons) setFrom(e.clientX); }}
        onKeyDown={onKey}
        sx={{ position: 'relative', height: 30, display: 'flex', alignItems: 'center', touchAction: 'none', cursor: 'pointer', outline: 'none', '&:focus-visible .knob': { boxShadow: (t) => `0 0 0 4px ${t.palette.action.focus}` } }}
      >
        <Box sx={{ position: 'absolute', left: 0, right: 0, height: 8, borderRadius: '999px', overflow: 'hidden', display: 'flex' }}>
          <Box sx={{ width: `${x}%`, bgcolor: (t) => (t.palette.mode === 'dark' ? '#7A6532' : '#F3D38D') }} />
          <Box sx={{ flex: 1, bgcolor: (t) => (t.palette.mode === 'dark' ? '#2F6B48' : '#8FD3A8') }} />
        </Box>
        {lx != null && <Box sx={{ position: 'absolute', left: 0, width: `${Math.max(0, lx)}%`, height: 3, borderRadius: '999px', bgcolor: 'success.dark', transition: 'width 80ms linear' }} />}
        <Box className="knob" sx={{ position: 'absolute', left: `calc(${x}% - 12px)`, width: 24, height: 24, borderRadius: '999px', bgcolor: 'background.paper', border: 2, borderColor: 'text.primary', boxSizing: 'border-box', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
      </Box>
      {hint && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.5 }}>{hint}</Typography>}
    </Box>
  );
}

/* 마이크 선택 시트 — 세션 화면 큰 설정 '입력 장치'·설정 '연결된 기기' 공용.
   1.4.0 앱은 장치 목록에서 고르고, 그 전 앱·브라우저는 지금 쓰는 장치 이름만 보여 준다.
   '자동' 항목은 숨긴다(2026-10-26) — 아무것도 고르지 않았거나 고른 장치가 빠져 있으면(네이티브가 자동으로 동작) 지금 쓰는 장치에 체크. */
export const MIC_ICON = { builtin: PhoneIcon, usb: UsbIcon, wired: HeadsetIcon, bluetooth: BluetoothIcon };
const BLUE = '#1F5BBF';
export function micKindName(k, t) {
  return ({ builtin: t('micBuiltin'), usb: t('micUsb'), wired: t('micWired'), bluetooth: t('micBt') }[k] || t('micBuiltin'));
}
// 지금 쓰는 장치의 표시 이름(설정 '연결된 기기' 값) — 'USB 마이크 (BOYA Magic)' 식
export function micCurrentName(mic, t) {
  const model = (/\(([^)]+)\)\s*$/.exec(String(mic.label || '')) || [])[1];
  return model ? `${micKindName(mic.kind, t)} (${model})` : micKindName(mic.kind, t);
}
export function MicSheet({ open, onClose, mic, stereo, children }) {
  const t = useT();
  const CurIcon = MIC_ICON[mic.kind] || MicIcon;
  return (
    <BottomSheet open={open} onClose={onClose} title={t('micPicker')}>
      <Box sx={{ px: 1.25, pb: 2.5, display: 'flex', flexDirection: 'column', gap: 0.25, overflowY: 'auto' }}>
        {mic.canPick ? mic.list.filter((d) => d.kind !== 'auto').map((d, _i, devs) => {
          const on = !!d.selected || (!!d.active && !devs.some((x) => x.selected));
          const Icon = MIC_ICON[d.kind] || MicIcon;
          const model = (/\(([^)]+)\)\s*$/.exec(String(d.label || '')) || [])[1];
          const sub = d.kind === 'builtin' ? t('micBuiltinSub') : d.kind === 'bluetooth' ? (model || '') : [model, (d.channels >= 2 || (d.active && stereo)) ? t('twoCh') : ''].filter(Boolean).join(' · ');
          return (
            <ButtonBase key={d.id} role="radio" aria-checked={on} onClick={() => mic.pick(d.id)}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minHeight: 64, px: 1.75, borderRadius: '16px', justifyContent: 'flex-start', textAlign: 'left', bgcolor: on ? 'action.hover' : 'transparent' }}>
              <Box sx={{ width: 40, height: 40, flex: 'none', borderRadius: '12px', bgcolor: d.kind === 'bluetooth' ? alpha(BLUE, 0.12) : 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', color: d.kind === 'bluetooth' ? BLUE : 'text.primary' }}>
                <Icon sx={{ fontSize: 20 }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{micKindName(d.kind, t)}</Typography>
                {sub && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.4 }}>{sub}</Typography>}
              </Box>
              {on && <CheckIcon aria-label={t('selected')} sx={{ fontSize: 22 }} />}
            </ButtonBase>
          );
        }) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minHeight: 64, px: 1.75 }}>
            <Box sx={{ width: 40, height: 40, flex: 'none', borderRadius: '12px', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CurIcon sx={{ fontSize: 20 }} /></Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{mic.label || micKindName(mic.kind, t)}</Typography>
              {window.AndroidAudio && <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{t('micNeedUpdate')}</Typography>}
            </Box>
          </Box>
        )}
        {children}
      </Box>
    </BottomSheet>
  );
}

/* 휠 선택(2026-10-27, 새 세션 언어) — 위아래로 굴려 가운데 줄이 선택된다(스크롤 스냅). 줄을 눌러도 그 줄로 굴러간다.
   options: [{ code, label, sub? }] · 바깥에서 value 가 바뀌면(칸 전환) 그 줄로 바로 이동.
   시트(SwipeableDrawer) 안에서 맨 위에서 아래로 굴려도 시트가 닫히지 않게 터치 시작을 시트에 넘기지 않는다(defaultMuiPrevented). */
const WHEEL_ROW = 46;
const WHEEL_ROWS = 5;
export function WheelPicker({ options, value, onChange, label }) {
  const ref = useRef(null);
  const settle = useRef(null);
  const idx = Math.max(0, options.findIndex((o) => o.code === value));
  const [live, setLive] = useState(idx); // 굴리는 동안 가운데 줄(강조용) — 멈추면 onChange
  useLayoutEffect(() => {
    const el = ref.current;
    setLive(idx);
    if (el && Math.round(el.scrollTop / WHEEL_ROW) !== idx) el.scrollTop = idx * WHEEL_ROW;
  }, [idx, options]);
  useEffect(() => () => clearTimeout(settle.current), []);
  const at = () => Math.min(options.length - 1, Math.max(0, Math.round((ref.current ? ref.current.scrollTop : 0) / WHEEL_ROW)));
  const onScroll = () => {
    setLive(at());
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const o = options[at()];
      if (o && o.code !== value) onChange(o.code);
    }, 100);
  };
  const go = (i) => { if (ref.current) ref.current.scrollTo({ top: i * WHEEL_ROW, behavior: 'smooth' }); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); go(Math.min(options.length - 1, live + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); go(Math.max(0, live - 1)); }
  };
  const cur = options[live];
  return (
    <Box sx={{ position: 'relative', height: WHEEL_ROW * WHEEL_ROWS, flex: 'none' }}>
      <Box aria-hidden="true" sx={{ position: 'absolute', left: 0, right: 0, top: WHEEL_ROW * 2, height: WHEEL_ROW, borderRadius: '14px', bgcolor: (th) => alpha(th.palette.text.primary, 0.05), pointerEvents: 'none' }} />
      <Box ref={ref} role="listbox" aria-label={label} aria-activedescendant={cur ? 'wheel-' + cur.code : undefined} tabIndex={0}
        onScroll={onScroll} onKeyDown={onKeyDown} onTouchStart={(e) => { e.nativeEvent.defaultMuiPrevented = true; }}
        sx={{
          position: 'relative', height: '100%', overflowY: 'auto', overscrollBehavior: 'contain', scrollSnapType: 'y mandatory',
          py: `${WHEEL_ROW * 2}px`, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, outline: 'none',
          maskImage: 'linear-gradient(to bottom, transparent 0, #000 32%, #000 68%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 32%, #000 68%, transparent 100%)',
        }}>
        {options.map((o, i) => {
          const on = i === live;
          return (
            <Box key={o.code} id={'wheel-' + o.code} role="option" aria-selected={on} onClick={() => go(i)}
              sx={{ height: WHEEL_ROW, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, px: 2, scrollSnapAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>
              <Typography component="span" noWrap sx={{ fontSize: on ? 19 : 17, fontWeight: on ? 800 : 500, color: on ? 'text.primary' : 'text.secondary', transition: 'font-size .12s, color .12s' }}>{o.label}</Typography>
              {o.sub && <Typography component="span" noWrap sx={{ fontSize: 13, color: 'text.disabled' }}>{o.sub}</Typography>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

