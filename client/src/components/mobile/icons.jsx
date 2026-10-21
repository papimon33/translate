/* 폰 화면 아이콘 — Lucide(둥근 선, 2026-10-22 '아이콘 비교' 시안에서 선택). PC 웹 화면은 MUI 아이콘 그대로.
   MUI 아이콘처럼 sx={{ fontSize, color }} 로 크기·색을 받는다(선 색 = currentColor). 선 굵기는 시안과 같은 1.75. */
import React, { forwardRef } from 'react';
import Box from '@mui/material/Box';
import {
  Mic, MicOff, Volume2, VolumeX, Play, SlidersHorizontal, CircleX, ChevronLeft, ChevronDown, ChevronRight,
  Usb, Bluetooth, Headset, Smartphone, Sparkles, Check, Languages, QrCode, Download, Headphones, Pencil,
  ListX, Trash2, Settings, Plus, ArrowRight, ArrowLeftRight, ArrowLeft, LogOut,
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
export const SlidersIcon = wrap(SlidersHorizontal, 'SlidersIcon');
export const EndIcon = wrap(CircleX, 'EndIcon');
export const BackIcon = wrap(ChevronLeft, 'BackIcon');
export const ChevronDownIcon = wrap(ChevronDown, 'ChevronDownIcon');
export const ChevronRightIcon = wrap(ChevronRight, 'ChevronRightIcon');
export const UsbIcon = wrap(Usb, 'UsbIcon');
export const BluetoothIcon = wrap(Bluetooth, 'BluetoothIcon');
export const HeadsetIcon = wrap(Headset, 'HeadsetIcon');
export const PhoneIcon = wrap(Smartphone, 'PhoneIcon');
export const AutoIcon = wrap(Sparkles, 'AutoIcon');
export const CheckIcon = wrap(Check, 'CheckIcon');
export const LanguagesIcon = wrap(Languages, 'LanguagesIcon');
export const QrIcon = wrap(QrCode, 'QrIcon');
export const DownloadIcon = wrap(Download, 'DownloadIcon');
export const HeadphonesIcon = wrap(Headphones, 'HeadphonesIcon');
export const PencilIcon = wrap(Pencil, 'PencilIcon');
export const ClearListIcon = wrap(ListX, 'ClearListIcon');
export const TrashIcon = wrap(Trash2, 'TrashIcon');
export const SettingsIcon = wrap(Settings, 'SettingsIcon');
export const PlusIcon = wrap(Plus, 'PlusIcon');
export const ArrowRightIcon = wrap(ArrowRight, 'ArrowRightIcon');
export const SwapIcon = wrap(ArrowLeftRight, 'SwapIcon');
export const ArrowLeftIcon = wrap(ArrowLeft, 'ArrowLeftIcon');
export const LogOutIcon = wrap(LogOut, 'LogOutIcon');
