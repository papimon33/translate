/* 폰 화면 아이콘 — Lucide(둥근 선, 2026-10-22 '아이콘 비교' 시안에서 선택). PC 웹 화면은 MUI 아이콘 그대로.
   MUI 아이콘처럼 sx={{ fontSize, color }} 로 크기·색을 받는다(선 색 = currentColor). 선 굵기는 시안과 같은 1.75. */
import React, { forwardRef } from 'react';
import Box from '@mui/material/Box';
import {
  Mic, MicOff, Volume2, VolumeX, Play, ChevronRight, Usb, Bluetooth, Headset, Smartphone, Check,
  QrCode, Download, Settings, Plus, ArrowRight, ArrowLeftRight, ArrowLeft, LogOut,
} from 'lucide-react';

const STROKE = 1.75;

function wrap(Icon, name, extra) {
  const C = forwardRef(function LucideIcon({ sx, ...rest }, ref) {
    return <Box component={Icon} ref={ref} strokeWidth={STROKE} {...extra} sx={{ width: '1em', height: '1em', fontSize: 24, flex: 'none', ...sx }} {...rest} />;
  });
  C.displayName = name;
  return C;
}

export const MicIcon = wrap(Mic, 'MicIcon');
export const MicOffIcon = wrap(MicOff, 'MicOffIcon');
export const VolumeOnIcon = wrap(Volume2, 'VolumeOnIcon');
export const VolumeOffIcon = wrap(VolumeX, 'VolumeOffIcon');
export const PlayIcon = wrap(Play, 'PlayIcon', { fill: 'currentColor' }); // 시작 버튼 안 — 채운 삼각형
export const ChevronRightIcon = wrap(ChevronRight, 'ChevronRightIcon');
export const UsbIcon = wrap(Usb, 'UsbIcon');
export const BluetoothIcon = wrap(Bluetooth, 'BluetoothIcon');
export const HeadsetIcon = wrap(Headset, 'HeadsetIcon');
export const PhoneIcon = wrap(Smartphone, 'PhoneIcon');
export const CheckIcon = wrap(Check, 'CheckIcon');
export const QrIcon = wrap(QrCode, 'QrIcon');
export const DownloadIcon = wrap(Download, 'DownloadIcon');
export const SettingsIcon = wrap(Settings, 'SettingsIcon');
export const PlusIcon = wrap(Plus, 'PlusIcon');
export const ArrowRightIcon = wrap(ArrowRight, 'ArrowRightIcon');
export const SwapIcon = wrap(ArrowLeftRight, 'SwapIcon');
export const ArrowLeftIcon = wrap(ArrowLeft, 'ArrowLeftIcon');
export const LogOutIcon = wrap(LogOut, 'LogOutIcon');

// 'TTS' 글자 모양 아이콘(둥근 선, Lucide 와 같은 굵기) — 하단 TTS 버튼. off 면 사선.
export const TtsIcon = forwardRef(function TtsIcon({ sx, off, ...rest }, ref) {
  return (
    <Box component="svg" ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      sx={{ width: '1em', height: '1em', fontSize: 24, flex: 'none', ...sx }} {...rest}>
      <path d="M1.8 7.5h5.6M4.6 7.5v9" />
      <path d="M8.6 7.5h5.6M11.4 7.5v9" />
      <path d="M21.6 9c-.5-1-1.5-1.6-2.7-1.6-1.5 0-2.6.8-2.6 2 0 2.8 5.6 1.6 5.6 4.6 0 1.3-1.2 2.2-2.9 2.2-1.2 0-2.3-.6-2.9-1.5" />
      {off && <path d="M3 21L21 3" />}
    </Box>
  );
});

// 번역 아이콘(2026-10-26, 사용자가 고른 SVG Repo 'translate-01') — 文 과 A 사이 번역. 하단 언어 버튼. 선 굵기는 TTS 아이콘과 같은 1.9.
export const TranslateIcon = forwardRef(function TranslateIcon({ sx, ...rest }, ref) {
  return (
    <Box component="svg" ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      sx={{ width: '1em', height: '1em', fontSize: 24, flex: 'none', ...sx }} {...rest}>
      <path d="M12.913 17H20.087M12.913 17L11 21M12.913 17L15.7783 11.009C16.0092 10.5263 16.1246 10.2849 16.2826 10.2086C16.4199 10.1423 16.5801 10.1423 16.7174 10.2086C16.8754 10.2849 16.9908 10.5263 17.2217 11.009L20.087 17M20.087 17L22 21M2 5H8M8 5H11.5M8 5V3M11.5 5H14M11.5 5C11.0039 7.95729 9.85259 10.6362 8.16555 12.8844M10 14C9.38747 13.7248 8.76265 13.3421 8.16555 12.8844M8.16555 12.8844C6.81302 11.8478 5.60276 10.4266 5 9M8.16555 12.8844C6.56086 15.0229 4.47143 16.7718 2 18" />
    </Box>
  );
});
